# AI Defense System: Cross-Provider Biothreat Detection

## Overview
This system helps prevent malicious actors from using AI platforms to orchestrate bioweapon development by tracking suspicious behavior patterns across multiple AI providers, even when attackers split their activities across different accounts or platforms. Think of it as a "neighborhood watch" for AI systems—when one platform sees a piece of suspicious activity, it can warn others, making it much harder for bad actors to hide their intentions by fragmenting their requests.

## Current Capabilities
### Pattern Detection

- **Multi-category threat identification**: Detects four categories of concerning patterns in API requests:
  - **BIOENGINEERING**: Nucleic acid synthesis, CRISPR, pathogen design, genetic modification
  - **CYBERATTACKS**: Hacking, exploits, malware, credential attacks, data exfiltration
  - **MANIPULATION**: Disinformation, deepfakes, bot networks, influence campaigns
  - **AUTOMATION**: Scraping, automated scripts, rate-limit circumvention

- **Dual detection methods**:
  - Keyword pattern matching for explicit indicators
  - Semantic similarity analysis using embeddings to catch obfuscated attempts

### Actor Fingerprinting

- **Multi-vector fingerprinting** that persists beyond disposable identifiers:
  - API authorization headers
  - Autonomous System Number (ASN) + User-Agent combinations
  - ASN + HTTP header structure patterns
- **Cross-account tracking**: Links suspicious activity even when attackers rotate email addresses or IP addresses

### Distributed Reputation System

- **Bloom filter architecture**: Memory-efficient probabilistic data structure for storing actor fingerprints across 12 filter variants (4 threat categories × 3 fingerprint types)
- **Cloudflare Workers integration**: Edge-deployed proxy that intercepts requests to OpenAI, Anthropic, and Google AI APIs
- **Real-time lookup and persistence**: Sub-millisecond fingerprint checks with automatic updates when new violations detected

### Adaptive Policy Enforcement

- **Violation threshold system**: Blocks requests when actor fingerprints appear in 2+ threat category filters
- **Graduated response**: Current implementation blocks high-risk actors (403 status) while logging sub-threshold violations for analysis
- **Provider-agnostic**: Works across OpenAI, Anthropic, and Google AI APIs through hostname-based routing

## Technical Architecture
The system operates as a Cloudflare Worker proxy that:

* Intercepts POST requests to AI provider APIs
* Generates multiple fingerprints for each request
* Analyzes request content using pattern matching and semantic embedding
* Queries the client's reputation using its fingerprints and the system's tracking (bloom filters managed in Cloudflare KV)
* Enforces policy decisions (block/allow) based on aggregated risk signals
* Updates bloom filters with newly detected violations for future requests

## Demo
This system is available in beta at [[provider]].llm-proxy.com, with forwarding/blocking meeting the basic objectives.
Example:

```
POST https://anthropic.llm-proxy.com/v1/messages
...post body follows
```

The request is forwarded to api.anthropic.com - or blocked if the body and prior requests overall contained literal or semantic content matching more than 1 risk policy (bioengineering, cyberattacks, manipulation or automation).

Example:
```
HTTP 403
{"status":"blocked","violations":["cyber","automation"]}
```

## Roadmap
The next milestone focuses on validating ROC-AUC improvements and false positive rates compared to single-provider detection, with a pivot decision planned for Day 21 based on whether federated reputation meaningfully enhances threat detection across fragmented attack chains.

## Security Note
This is research code demonstrating cross-provider coordination concepts for AI safety. Production deployment would require additional hardening, privacy considerations, and coordination with AI providers.
