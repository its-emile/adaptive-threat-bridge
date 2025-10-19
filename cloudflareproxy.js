
export default {

  /**
   * Calculate bit indices for an item using multiple hash functions
   * @param {string} item - The item to hash
   * @returns {number[]} - Array of bit indices
   */
  calculateBitIndices(item) {
    const BLOOM_FILTER_SIZE = 32 // 24042; // bits
    const NUM_HASH_FUNCTIONS = 3 // 15;
    
    const encoder = new TextEncoder();
    const data = encoder.encode(item);
    const bitIndices = [];
    
    for (let i = 0; i < NUM_HASH_FUNCTIONS; i++) {
      // For Cloudflare Workers, we'll use a simpler hash approach
      let hash = i * 0x9e3779b9; // Initial seed based on golden ratio
      
      for (let j = 0; j < data.length; j++) {
        hash = ((hash << 5) - hash) + data[j];
        hash = hash & hash; // Convert to 32-bit integer
      }
      
      // Apply additional mixing for each hash function
      hash = hash ^ (hash >>> 16);
      hash = Math.imul(hash, 0x85ebca6b);
      hash = hash ^ (hash >>> 13);
      hash = Math.imul(hash, 0xc2b2ae35);
      hash = hash ^ (hash >>> 16);
      
      // Get bit position (ensure positive and within range)
      const bitIndex = Math.abs(hash) % BLOOM_FILTER_SIZE;
      bitIndices.push(bitIndex);
    }
    
    return bitIndices;
  },

  /**
   * Bloom filter lookup with precalculated bit indices
   * @param {number[]} bitIndices - Precalculated bit indices
   * @param {string} bloomFilterData - Base64 encoded bloom filter bit array
   * @returns {boolean} - True if item might be in the set, false if definitely not
   */
  bloomFilterContains(bitIndices, bloomFilterData) {
    // Decode the bloom filter from base64 or hex string
    let bitArray;
    try {
      const binaryString = atob(bloomFilterData);
      if (Math.max(...bitIndices) > binaryString.length * 8) {
        return false;
      }
      // Assuming bloomFilterData is base64 encoded
      bitArray = new Uint8Array(Math.max(binaryString.length, Math.ceil(Math.max(...bitIndices) / 8)));
      for (let i = 0; i < binaryString.length; i++) {
        bitArray[i] = binaryString.charCodeAt(i);
      }
    } catch (e) {
      console.error("Failed to decode bloom filter data:", e);
      return false;
    }
    
    // Helper function to check if a bit is set
    const isBitSet = (bitIndex) => {
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      if (byteIndex >= bitArray.length) return false;
      return (bitArray[byteIndex] & (1 << bitOffset)) !== 0;
    };
    
    // If any bit is not set, the item is definitely not in the set
    for (const bitIndex of bitIndices) {
      if (!isBitSet(bitIndex)) {
        return false;
      }
    }
    
    // All bits were set, item might be in the set
    return true;
  },

  /**
   * Insert an item into a bloom filter using precalculated bit indices
   * @param {number[]} bitIndices - Precalculated bit indices (can vastly exceed 64-bit fields)
   * @param {string} bloomFilterData - Base64 encoded bloom filter bit array
   * @returns {string} - Updated base64 encoded bloom filter bit array
   */
  bloomFilterInsert(bitIndices, bloomFilterData) {
    // Decode the bloom filter from base64
    let bitArray;
    try {
      const binaryString = atob(bloomFilterData);
      bitArray = new Uint8Array(Math.max(binaryString.length, Math.ceil(Math.max(...bitIndices) / 8)));
      for (let i = 0; i < binaryString.length; i++) {
        bitArray[i] = binaryString.charCodeAt(i);
      }
    } catch (e) {
      console.error("Failed to decode bloom filter data:", e);
      return bloomFilterData;
    }
    
    // Helper function to set a bit
    const setBit = (bitIndex) => {
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      if (byteIndex < bitArray.length) {
        bitArray[byteIndex] |= (1 << bitOffset);
      }
    };
    
    // Set all bits for this item
    for (const bitIndex of bitIndices) {
      setBit(bitIndex);
    }
    
    // Encode back to base64
    let binaryString = '';
    for (let i = 0; i < bitArray.length; i++) {
      binaryString += String.fromCharCode(bitArray[i]);
    }
    return btoa(binaryString);
  },


  /**
   * Calculate the cosine similarity between two vectors
   * @param {number[]} a - First vector (array of numbers)
   * @param {number[]} b - Second vector (array of numbers)
   * @returns {number} - Cosine similarity score between -1 and 1
   * @throws {Error} - If input vectors have different dimensions
   */
  cosine_similarity(a, b) {
    // Ensure both vectors have the same dimensions
    if (a.length != b.length) throw new Error("inconsistent embedding dimensions");
    
    let dotproduct = 0;  // Stores the dot product of a and b
    let normA = 0;       // Stores the squared magnitude of vector a
    let normB = 0;       // Stores the squared magnitude of vector b
    
    // Calculate dot product and vector magnitudes in a single pass
    for (let j = 0; j < a.length; j++) {
      normA += a[j] * a[j];
      normB += b[j] * b[j];
      dotproduct += a[j] * b[j];
    }
    
    // Cosine similarity = (A·B) / (||A|| * ||B||)
    // Where ||A|| is the magnitude (Euclidean norm) of vector A
    return dotproduct / Math.sqrt(normA) / Math.sqrt(normB);
  },

  async fetch(request, env) {
    /*
      Forward to the AI provider UNLESS a threshold of violations is exceeded between the request and its fingerprint
    */
    
    // constructing the forward request
    const url = new URL(request.url)
    const incomingHostname = url.hostname.toLowerCase();
    
    if (incomingHostname.startsWith('openai')) {
      url.hostname = "api.openai.com";
    } else if (incomingHostname.startsWith('google')) {
      url.hostname = "generativelanguage.googleapis.com";
    } else if (incomingHostname.startsWith('anthropic')) {
      url.hostname = "api.anthropic.com";
    } else {
      // default fallback
      url.hostname = "api.openai.com";
    }
    const rqhold = new Request(
      url.toString(),
      request.clone()
    );
    
    
    // by default, allow the request
    var requestViolations=[];
    var allViolations=[];

    // Check for bioengineering-related content in POST requests
    if(request.method == "POST"){
      console.log("Processing POST")
      
      // fingerprinting
      const headerNames = [...request.headers]
        .map(([name]) => name)
        .join('\n');
      
      // Construct multiple fingerprints for better identification
      // Note: currently, this is a POC. Robust fingerprinting would use advanced/paid CF features or equivalent libraries.
      const AS = `AS${request.cf.asn || 'UNKNOWN'}`
      const pre_fingerprints = [
        // client's actual API key (in case they are not rotating)
        request.headers.get("Authorization") || '',
        // First custom fingerprint: AS+User-Agent
        AS + (request.headers.get("user-agent") || ''),
        // Second custom fingerprint: AS+Header names
        AS + ([...request.headers].map(([name]) => name).join('|')),
      ];

      // Hash for bloom filter. Precalculate bit indices for all fingerprints
      const fingerprints = pre_fingerprints.map(fp => this.calculateBitIndices(fp));

      // detect violations within this request
      const body = await request.text();
      
      const patterns = [
        { 
          pat: ["nucleic","genome","crispr","cas9","plasmid","synthetic biology","gene edit","genetic modif","transgene","recombinant","biowarfare","pathogen","toxin","synthetic pathogen"],
          type: 'bioengineering' 
        },
        { 
          pat: ["hack","exploit","vulnerability","ddos","phish","malware","ransomware","zero-day","sql-injection","xss","remote-code","privilege-escalation","brute-force","credential-stuffing","data-exfiltration"],
          type: 'cyber' 
        },
        { 
          pat: ["disinformation","misinformation","deepfake","synthetic media","astroturfing","sockpuppet","bot-network","influence-campaign","psyop","perception management","narrative control","gaslighting","manipulated content","ai-generated-content"],
          type: 'manipulation' 
        },
        { 
          pat: ["bot","scrap\\w","crawl\\w","automated-script","headless-browser","puppeteer","selenium","playwright","scraping-tool","web-crawler","rate-limit?","request-flood"],
          type: 'automation' 
        }
      ];
      
      // Test all patterns
      patterns.forEach(({ pat, type }) => {
        const pattern = new RegExp(pat.join('|'), 'gi');
        const matches = body.match(pattern);
        if (matches && matches.length > 1) { // 1 match could suffice, but if more than 1 match, it's very concerning (violation)
          requestViolations.push(type);
        }
      });
      
      // Test semantic versions of the patterns too
      var semantic_policies = [{text: body, type: 'request'}];
      patterns.forEach(({ pat, type }) => {
        semantic_policies.push({text: pat.join(', or '), type: type});
      })
      console.log("Policies:"+ semantic_policies.map(p => p.text))
      const sim_thresh = 0.64;
      const embeddings = await env.WAI.run(
        '@cf/baai/bge-base-en-v1.5',
        {text: semantic_policies.map(p => p.text)}
      );
      // calculate cosine similarities of the prompt to all policies 
      for(var i=1; i<semantic_policies.length; i++){
        var sim = this.cosine_similarity(embeddings.data[0], embeddings.data[i])
        console.log(sim);
        if(sim>sim_thresh){
          requestViolations.push(semantic_policies[i].type);
        }
      }
      // Multi-bloom filter policy: check the different fingerprints of the request
      // Trigger violation if fingerprint is found in 2 or more filters
      const detectionPolicyNames = ['cyber', 'bioengineering', 'manipulation', 'automation'];
      
      // Define fingerprint suffixes and their corresponding indices
      const fingerprintSuffixes = [
        { suffix: 'FP1', index: 0 },
        { suffix: 'FP2', index: 1 },
        { suffix: 'FP3', index: 2 }
      ];
      
      // Load all bloom filters (Type x Suffix)

      const lookupPromises = detectionPolicyNames.flatMap(name => {
        // Create promises for each fingerprint variant of each filter
        return fingerprintSuffixes.map(({suffix, index}) => {
          const filterKey = `${name}${suffix}`;
          const promise = env.BLOOM_FILTERS.get(filterKey, { 
            cacheTtl: 60,  // Cache at edge for 1min for fast reads
            type: 'text'
          }).catch(e => {
            console.error(`Failed to load ${filterKey} bloom filter from KV:`, e);
            return null;
          });
          
          return { 
            name: filterKey, 
            baseName: name,
            promise, 
            index 
          };
        });
      });
      const loadedFilters = await Promise.all(lookupPromises.map(async ({name, baseName, promise, index}) => {
        try {
          const data = await promise;
          return { name, baseName, data: data || null, index };
        } catch (e) {
          return { name, baseName, data: null, index };
        }
      }));
      
      var fingerprintViolations = [];
      for (const filter of loadedFilters) {
        // Check each fingerprint against its corresponding bloom filter, unless the fingerprint is too short
        if (filter.data && filter.index < fingerprints.length) {
          const hasMatch = pre_fingerprints[filter.index].length>2 && this.bloomFilterContains(
            fingerprints[filter.index],
            filter.data
          );
          
          if (hasMatch) {
            if (!fingerprintViolations.includes(filter.baseName)) {
              fingerprintViolations.push(filter.baseName);
              console.log(`Fingerprint matched in ${filter.name} bloom filter`);
            }
        }
      }
      
      
      //merge violations
      allViolations = [...new Set(requestViolations.concat(fingerprintViolations).map(v => v.replace(/[()]/g, '').trim()))];
      console.log("V: "+allViolations)
      // Persist violations: only insert fingerprints for NEW violations
      const newViolations = requestViolations.filter(v => !fingerprintViolations.includes(v));
      if (newViolations.length > 0 && fingerprints && fingerprints.length > 0) {
        // Create a unique set of filter keys that need updating
        const filterUpdates = new Map();
        
        // Collect all the filters that need to be updated
        for (const violationType of newViolations) {
          for (const { suffix, index } of fingerprintSuffixes) {
            if (index < fingerprints.length) {
              const key = `${violationType}${suffix}`;
              
              // Only add if we haven't already planned to update this filter
              if (!filterUpdates.has(key)) {
                filterUpdates.set(key, {
                  key,
                  fingerprintIndex: index,
                  violationType
                });
              }
            }
          }
        }
        
        // Execute updates in parallel, but only once per filter
        const persistPromises = Array.from(filterUpdates.values()).map(async ({ key, fingerprintIndex }) => {
          try {
            const currentFilter = await env.BLOOM_FILTERS.get(key, { type: 'text' });
            if (currentFilter) {
              const updatedFilter = this.bloomFilterInsert(fingerprints[fingerprintIndex], currentFilter);
              await env.BLOOM_FILTERS.put(key, updatedFilter);
              console.log(`Persisted fingerprint to ${key} bloom filter`);
            } else {
              console.warn(`Bloom filter ${key} not found in KV, skipping persistence`);
            }
          } catch (e) {
            console.error(`Failed to persist to ${key} bloom filter:`, e);
          }
        });
        
        // Wait for all updates to complete
        await Promise.all(persistPromises);
      }
    }
    // Policy: trigger violation if 2 or more bloom filters contain the fingerprint
    const VIOLATION_THRESHOLD = 2;
    if(allViolations.length>=VIOLATION_THRESHOLD){
      // block and explain
      const re_data = { "status": "blocked", "violations": allViolations }
      const gc = await rqhold.text();
      return new Response(JSON.stringify(re_data), {
        headers: { 'Content-Type': 'application/json' },
        status: 403
      });
    }else{
      // no violations detected from security service, fetch from origin
      if(allViolations.length > 0){
        console.log(`Sub-threshold violations detected (${allViolations.length}/${VIOLATION_THRESHOLD}): ${allViolations.join(', ')}`);
      }
      console.log("request forwarding to " + rqhold.url)
      var re = await fetch(rqhold, env)
      return re
    }
  }
}
};
