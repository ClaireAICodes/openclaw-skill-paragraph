---
name: paragraph
description: OpenClaw skill for Paragraph.com - Web3-native blogging platform with tokenization
version: 1.0.0
author: Phil (OpenClaw)
license: ISC

# Skill type
type: tool

# Main entry point
main: skill.js

# Environment variables required
env:
  - name: PARAGRAPH_API_KEY
    description: Paragraph API authentication key
    required: true
  - name: PARAGRAPH_PUBLICATION_SLUG
    description: Publication slug for URL building (required). Example: "myblog" or "jonathancolton.eth"
    required: true
  - name: PARAGRAPH_PUBLICATION_ID
    description: Default publication ID (optional, not needed if slug is set)
    required: false
  - name: PARAGRAPH_API_BASE_URL
    description: Custom API base URL (for testing)
    required: false

# Tools provided
tools:
  - paragraph_testConnection
  - paragraph_createPost
  - paragraph_getPost
  - paragraph_getPostBySlug
  - paragraph_listPosts
  - paragraph_getPublication
  - paragraph_getPublicationByDomain
  - paragraph_getMyPublication
  - paragraph_addSubscriber
  - paragraph_listSubscribers
  - paragraph_importSubscribers
  - paragraph_getFeed
  - paragraph_getPostsByTag
  - paragraph_getCoin
  - paragraph_getCoinByContract
  - paragraph_getPopularCoins
  - paragraph_listCoinHolders
  - paragraph_getUser
  - paragraph_getUserByWallet
  - paragraph_getSubscriberCount

# Dependencies
dependencies: []  # Uses native fetch, no external deps

# Tags for discovery
tags:
  - blogging
  - web3
  - nft
  - tokens
  - publishing
  - content
  - openclaw
  - openclaw-skill
  - paragraph
  - decentralized
  - onchain
  - social
  - creator-economy
  - content-automation

# Documentation
documentation: README.md

# Setup instructions
setup:
  - name: Get API key
    description: Go to Paragraph account settings → Integrations → Generate API key
  - name: Get publication slug
    description: Find your publication slug in your Paragraph dashboard (e.g., "myblog" or "jonathancolton.eth")
  - name: Set environment variables
    description: Add PARAGRAPH_API_KEY and PARAGRAPH_PUBLICATION_SLUG to OpenClaw environment
  - name: (Optional) Set default publication ID
    description: Set PARAGRAPH_PUBLICATION_ID if you prefer using ID over slug (slug is recommended)

# Example usage
examples:
  - description: Test Paragraph connection
    call: paragraph_testConnection
  - description: Get current publication (auto-discovers ID and slug)
    call: paragraph_getMyPublication
  - description: Create a blog post (fast response by default)
    call: paragraph_createPost
    params:
      title: "My Web3 Blog Post"
      markdown: "# Hello\n\nThis is my first post on Paragraph."
      sendNewsletter: false
      categories: ["web3", "blockchain"]
      # waitForProcessing defaults to false – returns immediately; set true to wait for slug/url
  - description: List recent posts in publication (auto-discovers ID)
    call: paragraph_listPosts
    params:
      limit: 10
      includeContent: false
  - description: Get token data for a coined post
    call: paragraph_getCoin
    params:
      coinId: "coin_123"

# Implementation notes
notes:
  - Uses native fetch API (Node 19+). No additional dependencies.
  - All tools return standardized { success, data, error } format.
  - Rate limiting: Implement retry/backoff in agent if needed.
  - CSV import expects text/csv raw bytes (see README for format).
  - Post updates (PUT) are not supported by the Paragraph API at this time.
  - Posts are published onchain immediately upon creation; slug and URL may be undefined until onchain processing completes.

---