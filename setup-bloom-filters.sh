#!/bin/bash

# Setup script for Cloudflare KV bloom filters
# This script automates the creation of KV namespace and upload of all bloom filters

set -e  # Exit on error

echo "=== Cloudflare KV Bloom Filter Setup ==="
echo ""

# Configuration
KV_NAMESPACE="violation-fingerprint-bloom-filters"
FILTERS=("cyber" "bioengineering" "manipulation" "automation")
VARIANTS=("FP1" "FP2" "FP3")

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "Error: wrangler CLI is not installed. Please install it first."
    echo "Run: npm install -g wrangler"
    exit 1
fi

# Step 1: Create KV namespace if it doesn't exist
echo "Step 1: Checking/creating KV namespace"
NAMESPACE_ID=$(wrangler kv:namespace list 2>/dev/null | grep -A 1 "$KV_NAMESPACE" | grep -oP '(?<=id: ").*?(?=")' || true)

if [ -z "$NAMESPACE_ID" ]; then
    echo "Creating new KV namespace: $KV_NAMESPACE"
    NAMESPACE_OUTPUT=$(wrangler kv:namespace create "$KV_NAMESPACE")
    NAMESPACE_ID=$(echo "$NAMESPACE_OUTPUT" | grep -oP '(?<=id: ").*?(?=")')
    
    if [ -z "$NAMESPACE_ID" ]; then
        echo "Error: Failed to create KV namespace"
        exit 1
    fi
    
    echo "✅ Created namespace $KV_NAMESPACE with ID: $NAMESPACE_ID"
    
    # Update wrangler.toml if it exists
    if [ -f "wrangler.toml" ]; then
        if ! grep -q "kv_namespaces" wrangler.toml; then
            echo -e "\n[kv_namespaces]" >> wrangler.toml
        fi
        
        # Add or update the namespace in wrangler.toml
        if grep -q "binding = \"$KV_NAMESPACE\"" wrangler.toml; then
            sed -i '' -e "/binding = \"$KV_NAMESPACE\"/,/^\s*$/c\\
[[kv_namespaces]]\\
binding = \"$KV_NAMESPACE\"\\
id = \"$NAMESPACE_ID\"\\
" wrangler.toml
        else
            echo -e "\n[[kv_namespaces]]" >> wrangler.toml
            echo "binding = \"$KV_NAMESPACE\"" >> wrangler.toml
            echo "id = \"$NAMESPACE_ID\"" >> wrangler.toml
        fi
        
        echo "✅ Updated wrangler.toml with new namespace ID"
    else
        echo "⚠️  wrangler.toml not found. Please add the following configuration manually:"
        echo ""
        echo "[[kv_namespaces]]"
        echo "binding = \"$KV_NAMESPACE\""
        echo "id = \"$NAMESPACE_ID\""
        echo ""
    fi
else
    echo "✅ Using existing namespace $KV_NAMESPACE with ID: $NAMESPACE_ID"
fi

echo ""

# Step 2: Upload bloom filters
echo "Step 2: Uploading bloom filters to KV"

for filter in "${FILTERS[@]}"; do
    for variant in "${VARIANTS[@]}"; do
        FILENAME="${filter}_${variant}.txt"
        KEY_NAME="${filter}_${variant}"
        
        if [ ! -f "$FILENAME" ]; then
            echo "⚠️  File not found: $FILENAME. Skipping..."
            continue
        fi
        
        echo "📤 Uploading $KEY_NAME..."
        wrangler kv:key put --namespace-id="$NAMESPACE_ID" "$KEY_NAME" "$(cat "$FILENAME")" 
        
        if [ $? -eq 0 ]; then
            echo "   ✅ Successfully uploaded $KEY_NAME"
        else
            echo "   ❌ Failed to upload $KEY_NAME"
        fi
    done
done

echo ""

# Step 3: Verify uploads
echo "Step 3: Verifying uploads"
echo "Listing all keys in namespace $KV_NAMESPACE:"
wrangler kv:key list --namespace-id="$NAMESPACE_ID"

echo ""

# Step 4: Deploy worker if wrangler.toml exists
if [ -f "wrangler.toml" ]; then
    echo "Step 4: Deploying worker"
    wrangler deploy
else
    echo "Step 4: No wrangler.toml found. Skipping worker deployment."
    echo "To deploy your worker, create a wrangler.toml configuration first."
fi

echo ""

# Final notes
echo "=== Setup Complete ==="
echo "All bloom filters have been uploaded to Cloudflare KV."
echo ""
echo "=== Performance Characteristics ==="
echo "- Read latency: <50ms (edge cached)"
echo "- Cache TTL: 300 seconds (5 minutes)"
echo "- Global propagation: ~60 seconds after update"
echo "- Size limit: 25MB per key"
echo ""
echo "To verify individual keys, use:"
echo "  wrangler kv:key get --namespace-id=$NAMESPACE_ID <key_name>"
echo ""
