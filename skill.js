#!/usr/bin/env node

/**
 * Paragraph OpenClaw Skill (REST API implementation)
 * Uses native fetch to interact with Paragraph.com API
 */

// Configuration
const API_BASE = process.env.PARAGRAPH_API_BASE_URL || "https://public.api.paragraph.com/api"
const API_KEY = process.env.PARAGRAPH_API_KEY
// DEFAULT_PUBLICATION_ID can be set manually, but will auto-discover from API if not provided
let DEFAULT_PUBLICATION_ID = process.env.PARAGRAPH_PUBLICATION_ID || null
// Publication slug (for URL building) - auto-discovered alongside ID
let DEFAULT_PUBLICATION_SLUG = null

/**
 * Standardized response format
 * @typedef {Object} ParagraphResult
 * @property {boolean} success
 * @property {any} data
 * @property {string} error
 */

/**
 * Make authenticated request to Paragraph API
 * @param {string} method - HTTP method
 * @param {string} endpoint - API endpoint (without base, e.g., "/v1/posts")
 * @param {Object} body - Request body (will be JSON stringified)
 * @param {Object} params - Query parameters
 * @param {Object} options - Additional options (formData, rawBody)
 * @returns {Promise<any>}
 */
async function request(method, endpoint, body = null, params = {}, options = {}) {
  if (!API_KEY) {
    throw new Error("PARAGRAPH_API_KEY environment variable not set")
  }

  const url = new URL(`${API_BASE}${endpoint}`)
  Object.keys(params).forEach(key => {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.append(key, String(params[key]))
    }
  })

  const headers = {
    "Authorization": `Bearer ${API_KEY}`
  }

  let fetchBody = null
  if (body) {
    headers["Content-Type"] = "application/json"
    fetchBody = JSON.stringify(body)
  }

  if (options.rawBody) {
    fetchBody = options.rawBody
    Object.assign(headers, options.headers)
  } else if (options.formData) {
    fetchBody = options.formData
    // Don't set Content-Type; fetch will set boundary
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: fetchBody
  })

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status} ${response.statusText}`
    try {
      const errorData = await response.json()
      errorMsg = errorData.msg || errorData.message || errorData.error || errorMsg
    } catch (e) {}
    throw new Error(errorMsg)
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return { success: true }
  }

  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    return await response.json()
  }
  return await response.text()
}

/**
 * Auto-discover publication ID and slug from the API key by fetching the feed
 * Caches the results in DEFAULT_PUBLICATION_ID and DEFAULT_PUBLICATION_SLUG
 * Returns the publication ID
 */
async function discoverPublicationId() {
  if (DEFAULT_PUBLICATION_ID) {
    return DEFAULT_PUBLICATION_ID
  }

  try {
    // Fetch a small feed to get a post with publication info
    const result = await request("GET", "/v1/posts/feed", null, { limit: 1 })
    if (result.items && result.items.length > 0) {
      const pub = result.items[0].publication
      if (pub) {
        // Prefer slug from the feed - it's the stable identifier
        if (pub.slug) {
          DEFAULT_PUBLICATION_SLUG = pub.slug
        } else if (pub.customDomain) {
          DEFAULT_PUBLICATION_SLUG = pub.customDomain
        }

        // Now fetch the full publication using the slug to get the canonical ID
        if (DEFAULT_PUBLICATION_SLUG) {
          const fullPub = await request("GET", `/v1/publications/slug/${encodeURIComponent(DEFAULT_PUBLICATION_SLUG)}`)
          if (fullPub && fullPub.id) {
            DEFAULT_PUBLICATION_ID = String(fullPub.id)
            // Ensure slug is cached
            if (!DEFAULT_PUBLICATION_SLUG && fullPub.slug) {
              DEFAULT_PUBLICATION_SLUG = fullPub.slug
            }
            return DEFAULT_PUBLICATION_ID
          }
        }
      }
    }
  } catch (e) {
    // Silently fall through to error later
  }

  throw new Error("Could not auto-discover publication ID. Either set PARAGRAPH_PUBLICATION_ID env var, or ensure your publication has at least one post to read from the feed.")
}

/**
 * Get the publication slug (for URL building)
 * Tries to auto-discover if not already cached
 */
async function getPublicationSlug() {
  if (DEFAULT_PUBLICATION_SLUG) {
    return DEFAULT_PUBLICATION_SLUG
  }

  // Ensure we have the ID first
  const id = await discoverPublicationId()

  try {
    // Fetch publication details to get the slug
    const pub = await request("GET", `/v1/publications/${id}`)
    if (pub.slug) {
      DEFAULT_PUBLICATION_SLUG = pub.slug
      return DEFAULT_PUBLICATION_SLUG
    }
    if (pub.customDomain) {
      DEFAULT_PUBLICATION_SLUG = pub.customDomain
      return DEFAULT_PUBLICATION_SLUG
    }
  } catch (e) {
    // Fall through
  }

  throw new Error("Could not determine publication slug. Set PARAGRAPH_PUBLICATION_ID and ensure the publication exists.")
}

/**
 * Wrap tools with standardized error handling
 */
function wrapTool(fn) {
  return async (...args) => {
    try {
      const data = await fn(...args)
      return { success: true, data, error: null }
    } catch (error) {
      return { success: false, data: null, error: error.message || String(error) }
    }
  }
}

/**
 * @type {Object.<string, Function>}
 */
export const tools = {
  /**
   * Test connection and authentication
   */
  paragraph_testConnection: wrapTool(async () => {
    // Call a lightweight authenticated endpoint to verify API key
    const result = await request("GET", "/v1/subscribers", null, { limit: 1 })
    // If we get here, auth worked
    return {
      message: "Connected to Paragraph API",
      hasSubscribers: (result.items?.length || 0) > 0,
      totalSubscribers: result.pagination?.total || 0
    }
  }),

  /**
   * Create a new post
   * Note: Posts are always published immediately (no draft mode). To "update", you would need to create a new post.
   */
  paragraph_createPost: wrapTool(async ({
    title,
    markdown,
    subtitle,
    imageUrl,
    sendNewsletter = false,
    slug,
    postPreview,
    categories
  }) => {
    if (!title || !markdown) {
      throw new Error("Missing required parameters: title, markdown")
    }

    // Build request body directly (no wrapper)
    const body = {
      title,
      markdown,
      sendNewsletter
    }

    if (subtitle) body.subtitle = subtitle
    if (imageUrl) body.imageUrl = imageUrl
    if (slug) body.slug = slug
    if (postPreview) body.postPreview = postPreview
    if (categories) body.categories = categories // array or comma-separated string

    const result = await request("POST", "/v1/posts", body)
    return {
      id: result.id,
      slug: result.slug,
      url: result.url,
      publishedAt: result.publishedAt
    }
  }),

  /**
   * Get a post by ID
   */
  paragraph_getPost: wrapTool(async ({ postId }) => {
    if (!postId) throw new Error("postId is required")
    const result = await request("GET", `/v1/posts/${postId}`)
    return result
  }),

  /**
   * Get a post by publication slug and post slug
   */
  paragraph_getPostBySlug: wrapTool(async ({ publicationSlug, postSlug }) => {
    if (!publicationSlug || !postSlug) {
      throw new Error("publicationSlug and postSlug are required")
    }
    // Encode slugs to handle special characters
    const encSlug = encodeURIComponent(publicationSlug)
    const encPostSlug = encodeURIComponent(postSlug)
    const result = await request("GET", `/publications/slug/${encSlug}/posts/slug/${encPostSlug}`)
    return result
  }),

  /**
   * List posts in a publication
   */
  paragraph_listPosts: wrapTool(async ({
    publicationId,
    limit = 10,
    cursor,
    includeContent = false
  }) => {
    const pubId = publicationId || await discoverPublicationId()
    if (!pubId) throw new Error("publicationId required or PARAGRAPH_PUBLICATION_ID must be set, or feed must have posts to auto-discover")

    const params = { limit }
    if (cursor) params.cursor = cursor
    if (includeContent) params.includeContent = "true"

    const result = await request("GET", `/v1/publications/${pubId}/posts`, null, params)
    return {
      posts: result.items || [],
      pagination: result.pagination || {}
    }
  }),

  /**
   * Get publication by slug
   */
  paragraph_getPublication: wrapTool(async ({ slug }) => {
    if (!slug) throw new Error("slug is required")
    const result = await request("GET", `/publications/slug/${encodeURIComponent(slug)}`)
    return result
  }),

  /**
   * Get publication by custom domain
   */
  paragraph_getPublicationByDomain: wrapTool(async ({ domain }) => {
    if (!domain) throw new Error("domain is required")
    const result = await request("GET", `/publications/domain/${encodeURIComponent(domain)}`)
    return result
  }),

  /**
   * Get the current publication associated with the API key
   * This auto-discovers the publication (via feed -> slug -> ID) and returns full details
   */
  paragraph_getMyPublication: wrapTool(async () => {
    // This will populate DEFAULT_PUBLICATION_ID and DEFAULT_PUBLICATION_SLUG
    const id = await discoverPublicationId()
    // Now fetch full publication details by the canonical ID
    const result = await request("GET", `/v1/publications/${id}`)
    // Also ensure slug is cached for URL building
    if (result.slug) DEFAULT_PUBLICATION_SLUG = result.slug
    if (result.customDomain) DEFAULT_PUBLICATION_SLUG = result.customDomain
    return result
  }),

  /**
   * Add a new subscriber
   */
  paragraph_addSubscriber: wrapTool(async ({
    email,
    wallet,
    sendWelcomeEmail = true
  }) => {
    if (!email && !wallet) throw new Error("At least one of email or wallet is required")

    const result = await request("POST", "/v1/subscribers", {
      email,
      wallet,
      sendWelcomeEmail
    })
    // Response may be { success: true } or include id, etc.
    return result
  }),

  /**
   * List subscribers (cursor-based pagination)
   */
  paragraph_listSubscribers: wrapTool(async ({
    limit = 10,
    cursor
  }) => {
    const params = { limit }
    if (cursor) params.cursor = cursor

    // Note: Endpoint does not require publicationId - API key scopes to a publication
    const result = await request("GET", "/v1/subscribers", null, params)
    return {
      subscribers: result.items || [],
      pagination: result.pagination || {}
    }
  }),

  /**
   * Import subscribers from CSV
   */
  paragraph_importSubscribers: wrapTool(async ({ csvPath, sendWelcomeEmail = true }) => {
    if (!csvPath) throw new Error("csvPath is required")

    const fs = await import('fs')
    const csvBuffer = fs.readFileSync(csvPath)

    // Build URL with query param
    const url = new URL(`${API_BASE}/v1/subscribers/import`)
    url.searchParams.append('sendWelcomeEmail', sendWelcomeEmail)

    const formData = new FormData()
    formData.append('file', csvBuffer, 'subscribers.csv')

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`
        // Content-Type (with boundary) set automatically by fetch when using FormData
      },
      body: formData
    })

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status} ${response.statusText}`
      try {
        const errorData = await response.json()
        errorMsg = errorData.msg || errorData.message || errorData.error || errorMsg
      } catch (e) {}
      throw new Error(errorMsg)
    }

    if (response.status === 204) {
      return { imported: 0, skipped: 0, total: 0 }
    }

    const result = await response.json()
    return {
      imported: result.imported || 0,
      skipped: result.skipped || 0,
      total: result.total || 0
    }
  }),

  /**
   * Get coin (tokenized post) by ID
   */
  paragraph_getCoin: wrapTool(async ({ coinId }) => {
    if (!coinId) throw new Error("coinId is required")
    const result = await request("GET", `/v1/coins/${coinId}`)
    return result
  }),

  /**
   * Get coin by contract address
   */
  paragraph_getCoinByContract: wrapTool(async ({ contractAddress }) => {
    if (!contractAddress) throw new Error("contractAddress is required")
    const result = await request("GET", `/v1/coins/contract/${contractAddress}`)
    return result
  }),

  /**
   * Get popular coins
   */
  paragraph_getPopularCoins: wrapTool(async () => {
    const result = await request("GET", "/v1/coins/list/popular")
    return result.coins || result.items || result
  }),

  /**
   * List coin holders
   */
  paragraph_listCoinHolders: wrapTool(async ({
    coinId,
    limit = 50,
    cursor
  }) => {
    if (!coinId) throw new Error("coinId is required")
    const params = { limit }
    if (cursor) params.cursor = cursor

    const result = await request("GET", `/v1/coins/${coinId}/holders`, null, params)
    return {
      holders: result.holders || [],
      pagination: result.pagination || {}
    }
  }),

  /**
   * Get user by ID
   */
  paragraph_getUser: wrapTool(async ({ userId }) => {
    if (!userId) throw new Error("userId is required")
    const result = await request("GET", `/v1/users/${userId}`)
    return result
  }),

  /**
   * Get user by wallet address
   */
  paragraph_getUserByWallet: wrapTool(async ({ walletAddress }) => {
    if (!walletAddress) throw new Error("walletAddress is required")
    const result = await request("GET", `/v1/users/wallet/${walletAddress}`)
    return result
  }),

  /**
   * Get subscriber count for a publication (by ID)
   */
  paragraph_getSubscriberCount: wrapTool(async ({ publicationId }) => {
    if (!publicationId) throw new Error("publicationId is required")
    const result = await request("GET", `/v1/publications/${publicationId}/subscribers/count`)
    return { count: result.count }
  }),

  /**
   * Get feed (curated posts) - public, no auth required
   */
  paragraph_getFeed: wrapTool(async ({ limit = 20, cursor }) => {
    const params = { limit }
    if (cursor) params.cursor = cursor
    const result = await request("GET", "/v1/posts/feed", null, params)
    return {
      posts: result.items || [],
      pagination: result.pagination || {}
    }
  }),

  /**
   * Get posts by tag
   */
  paragraph_getPostsByTag: wrapTool(async ({ tag, limit = 20, cursor }) => {
    if (!tag) throw new Error("tag is required")
    const params = { limit }
    if (cursor) params.cursor = cursor
    const result = await request("GET", `/v1/posts/tag/${encodeURIComponent(tag)}`, null, params)
    return {
      posts: result.items || [],
      pagination: result.pagination || {}
    }
  })
}

export default tools
