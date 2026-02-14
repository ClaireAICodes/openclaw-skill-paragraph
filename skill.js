#!/usr/bin/env node

/**
 * Paragraph OpenClaw Skill (REST API implementation)
 * Uses native fetch to interact with Paragraph.com API
 */

// Configuration
const API_BASE = process.env.PARAGRAPH_API_BASE_URL || "https://public.api.paragraph.com/api"
const API_KEY = process.env.PARAGRAPH_API_KEY
// DEFAULT_PUBLICATION_ID is rarely needed - API key usually scopes to a publication
const DEFAULT_PUBLICATION_ID = process.env.PARAGRAPH_PUBLICATION_ID || null

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
   */
  paragraph_createPost: wrapTool(async ({
    title,
    markdown,
    published = false,
    tags = [],
    coverImage,
    series,
    canonicalUrl,
    sendNewsletter = false,
    publicationId
  }) => {
    if (!title || !markdown) {
      throw new Error("Missing required parameters: title, markdown")
    }

    const article = {
      title,
      body_markdown: markdown,
      published,
      tags,
      sendNewsletter
    }

    if (coverImage) article.coverImage = coverImage
    if (series) article.series = series
    if (canonicalUrl) article.canonical_url = canonicalUrl

    // If publicationId is provided, use it; otherwise rely on API key scoping
    const endpoint = publicationId ? `/publications/${publicationId}/posts` : "/v1/posts"
    const result = await request("POST", endpoint, { article })
    return {
      id: result.id,
      slug: result.slug,
      url: result.url,
      published: result.published
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
   * Update an existing post
   */
  paragraph_updatePost: wrapTool(async ({
    postId,
    title,
    markdown,
    published,
    tags,
    coverImage,
    series,
    canonicalUrl
  }) => {
    if (!postId) throw new Error("postId is required")

    const updates = {}
    if (title !== undefined) updates.title = title
    if (markdown !== undefined) updates.body_markdown = markdown
    if (published !== undefined) updates.published = published
    if (tags !== undefined) updates.tags = tags
    if (coverImage !== undefined) updates.coverImage = coverImage
    if (series !== undefined) updates.series = series
    if (canonicalUrl !== undefined) updates.canonical_url = canonicalUrl

    if (Object.keys(updates).length === 0) {
      throw new Error("No update fields provided")
    }

    const result = await request("PUT", `/v1/posts/${postId}`, { article: updates })
    return result
  }),

  /**
   * List posts in a publication
   */
  paragraph_listPosts: wrapTool(async ({
    publicationId,
    limit = 20,
    cursor,
    status
  }) => {
    const pubId = publicationId || DEFAULT_PUBLICATION_ID
    if (!pubId) throw new Error("publicationId required or set DEFAULT_PUBLICATION_ID")

    const params = { limit }
    if (cursor) params.cursor = cursor
    if (status) params.status = status

    const result = await request("GET", `/publications/${pubId}/posts`, null, params)
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
