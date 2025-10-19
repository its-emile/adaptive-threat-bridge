# Cloudflare KV Bloom Filter Setup

This document explains how to set up and manage bloom filters using Cloudflare KV for the AI proxy security worker.

## Why KV?

**Performance Requirements Met:**
- ✅ Read latency: <50ms (well under your 250ms requirement)
- ✅ Global edge caching with 5-minute TTL
- ✅ Perfect for 2.5KB bloom filters (4 filters = 10KB total)
- ⚠️ Global propagation: ~60 seconds (not 5 seconds, but reads are cached)

## Setup Instructions

### 1. Create KV Namespace

```bash
wrangler kv:namespace create BLOOM_FILTERS
```

This will output something like:
```
🌀 Creating namespace with title "ai-proxy-security-BLOOM_FILTERS"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "BLOOM_FILTERS", id = "abc123def456..." }
```

### 2. Update wrangler.toml

Replace `YOUR_KV_NAMESPACE_ID` in `wrangler.toml` with the ID from step 1.

### 3. Upload Bloom Filters

Upload your 4 bloom filters (base64 encoded):

```bash
# Replace YOUR_NAMESPACE_ID with your actual namespace ID
NAMESPACE_ID="your_namespace_id_here"

# Upload each bloom filter
wrangler kv:key put --namespace-id=$NAMESPACE_ID "cyber" "$(cat cyber_filter.txt)"
wrangler kv:key put --namespace-id=$NAMESPACE_ID "bioengineering" "$(cat bio_filter.txt)"
wrangler kv:key put --namespace-id=$NAMESPACE_ID "manipulation" "$(cat manipulation_filter.txt)"
wrangler kv:key put --namespace-id=$NAMESPACE_ID "automation" "$(cat automation_filter.txt)"
```

Or upload directly with base64 data:
```bash
wrangler kv:key put --namespace-id=$NAMESPACE_ID "cyber" "AAAA8A8="
```

### 4. Verify Upload

```bash
# List all keys
wrangler kv:key list --namespace-id=$NAMESPACE_ID

# Get a specific filter
wrangler kv:key get --namespace-id=$NAMESPACE_ID "cyber"
```

### 5. Deploy Worker

```bash
wrangler deploy
```

## Updating Bloom Filters

To update a bloom filter (propagates globally in ~60 seconds):

```bash
wrangler kv:key put --namespace-id=$NAMESPACE_ID "cyber" "NEW_BASE64_DATA"
```

**Note:** Edge caches will continue serving the old version for up to 5 minutes (cacheTtl: 300). To force immediate updates, you can:
1. Lower the cacheTtl in the code (trade-off: more KV reads)
2. Use a versioned key scheme (e.g., `cyber_v2`)

## Performance Characteristics

| Metric | Value | Your Requirement |
|--------|-------|------------------|
| Read Latency | <50ms | <250ms ✅ |
| Cache Duration | 5 minutes | - |
| Global Sync | ~60 seconds | 5 seconds ⚠️ |
| Size Limit | 25MB/key | 2.5KB ✅ |
| Reads/day (free) | 100,000 | - |
| Writes/day (free) | 1,000 | - |

## Code Changes

The worker now:
1. **Loads filters in parallel** from KV using `Promise.all()`
2. **Caches at edge** for 5 minutes (`cacheTtl: 300`)
3. **Handles failures gracefully** - if a filter fails to load, it's treated as null
4. **No environment variables needed** - filters are stored in KV

## Cost Estimate

For typical usage:
- **Reads:** ~100K requests/day × 4 filters = 400K reads/day
- **Free tier:** 100K reads/day
- **Overage:** 300K reads × $0.50/million = **$0.15/day** (~$4.50/month)

Writes are infrequent (only when updating filters), so likely free.

## Alternative: Faster Global Sync

If you need true 5-second global synchronization, consider:

### Option A: Durable Objects
- Guarantees strong consistency
- Single-region writes (adds latency)
- More complex setup

### Option B: Cache API + KV
- Write to both Cache API (instant) and KV (persistent)
- Requires cache invalidation strategy
- More code complexity

For most use cases, **60-second propagation with edge caching is sufficient** since:
- Reads are <50ms (cached at edge)
- Updates are infrequent
- 5-minute cache means most requests never hit KV

## Troubleshooting

### "KV namespace not found"
- Verify namespace ID in `wrangler.toml` matches the created namespace
- Run `wrangler kv:namespace list` to see all namespaces

### "Bloom filter data is null"
- Verify filters are uploaded: `wrangler kv:key list --namespace-id=$NAMESPACE_ID`
- Check filter data: `wrangler kv:key get --namespace-id=$NAMESPACE_ID "cyber"`

### "Slow reads"
- Check if cacheTtl is set (should be 300)
- Verify you're not hitting rate limits
- Monitor with `wrangler tail` to see actual latencies
