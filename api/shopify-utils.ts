import { getShopifyClient } from './lib/shopify-client.js';
import { VercelResponse } from '@vercel/node';

export async function validateShopifyConnection(res: VercelResponse) {
  try {
    console.log("GET /api/validate-shopify request received");
    console.log("SHOPIFY_SHOP:", process.env.SHOPIFY_SHOP ? "SET" : "NOT SET");
    console.log("SHOPIFY_ADMIN_ACCESS_TOKEN:", process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ? "SET (length: " + process.env.SHOPIFY_ADMIN_ACCESS_TOKEN.length + ")" : "NOT SET");
    console.log("SHOPIFY_API_VERSION:", process.env.SHOPIFY_API_VERSION || "2025-01 (default)");

    const shopifyClient = getShopifyClient();

    console.log("Attempting to validate Shopify connection...");
    let isConnected = false;
    let connectionError: Error | null = null;

    try {
      isConnected = await shopifyClient.validateConnection();
      console.log("Shopify connection validation result:", isConnected);
    } catch (err) {
      connectionError = err instanceof Error ? err : new Error(String(err));
      console.error("Connection validation threw error:", connectionError.message);
    }

    if (!isConnected) {
      const errorDetails = connectionError?.message || "Shopify credentials are not properly configured.";
      console.error("Shopify connection failed. Details:", errorDetails);

      return res.status(503).json({
        success: false,
        isConnected: false,
        error: "Cannot connect to Shopify",
        details: errorDetails,
        suggestion: "Please verify that SHOPIFY_SHOP and SHOPIFY_ADMIN_ACCESS_TOKEN are correctly set and that your Shopify API access token is still valid.",
      });
    }

    try {
      console.log("Attempting to retrieve blog ID...");
      const blogId = await shopifyClient.getBlogId();
      console.log(`Successfully validated Shopify connection. Blog ID: ${blogId}`);
      return res.json({
        success: true,
        isConnected: true,
        message: "Shopify is properly configured",
        blogId,
      });
    } catch (blogError) {
      const blogErrorMessage = blogError instanceof Error ? blogError.message : "Cannot retrieve blog information";
      console.error("Error getting blog ID:", blogErrorMessage);

      const blogIdFromEnv = process.env.BLOG_ID;
      if (blogIdFromEnv) {
        console.log("Using BLOG_ID from environment:", blogIdFromEnv);
        return res.json({
          success: true,
          isConnected: true,
          message: "Shopify is properly configured (using BLOG_ID from environment)",
          blogId: blogIdFromEnv,
        });
      }

      return res.status(400).json({
        success: false,
        isConnected: true,
        error: "Shopify is connected but no blog found",
        details: blogErrorMessage,
        suggestion: "Please ensure your Shopify store has at least one blog and that your access token has blog permissions. Alternatively, you can set the BLOG_ID environment variable directly.",
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error validating Shopify:", errorMessage);

    if (errorMessage.includes("not configured")) {
      return res.status(503).json({
        success: false,
        isConnected: false,
        error: "Shopify is not configured",
        details: "Missing Shopify credentials",
        suggestion: "Please set SHOPIFY_SHOP and SHOPIFY_ADMIN_ACCESS_TOKEN environment variables.",
      });
    }

    res.status(500).json({
      success: false,
      isConnected: false,
      error: "Failed to validate Shopify connection",
      details: errorMessage,
    });
  }
}

export async function diagnoseShopify(res: VercelResponse) {
  try {
    const diagnostics: any = {
      timestamp: new Date().toISOString(),
      status: "ok",
      issues: [],
      environment: {},
      connection: null,
    };

    const shopName = process.env.SHOPIFY_SHOP;
    const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-01";
    const blogId = process.env.BLOG_ID;

    diagnostics.environment = {
      SHOPIFY_SHOP: shopName ? `✓ Set (${shopName})` : "✗ NOT SET",
      SHOPIFY_ADMIN_ACCESS_TOKEN: accessToken ? `✓ Set (length: ${accessToken.length})` : "✗ NOT SET",
      SHOPIFY_API_VERSION: apiVersion,
      BLOG_ID: blogId ? `✓ Set (${blogId})` : "Not set (will be fetched)",
    };

    if (!shopName) {
      diagnostics.issues.push("SHOPIFY_SHOP environment variable is not set");
    } else if (!shopName.includes("myshopify.com")) {
      diagnostics.issues.push(`SHOPIFY_SHOP format may be incorrect: "${shopName}". Expected format: "myshop.myshopify.com"`);
    }

    if (!accessToken) {
      diagnostics.issues.push("SHOPIFY_ADMIN_ACCESS_TOKEN environment variable is not set");
    } else if (accessToken.length < 20) {
      diagnostics.issues.push(`SHOPIFY_ADMIN_ACCESS_TOKEN seems too short (${accessToken.length} chars). Access tokens are typically longer.`);
    }

    if (shopName && accessToken) {
      try {
        console.log(`[Diagnose] Attempting connection to ${shopName}`);
        const baseUrl = `https://${shopName}/admin/api/${apiVersion}`;
        console.log(`[Diagnose] Full URL: ${baseUrl}/shop.json`);

        const response = await fetch(`${baseUrl}/shop.json`, {
          headers: {
            "X-Shopify-Access-Token": accessToken,
          },
        });

        console.log(`[Diagnose] Response status: ${response.status}`);

        if (response.ok) {
          const data = await response.json();
          diagnostics.connection = {
            status: "✓ Connected",
            shopName: data.shop?.name,
            url: `${baseUrl}/shop.json`,
            responseStatus: response.status,
          };
          console.log(`[Diagnose] Successfully connected to shop: ${data.shop?.name}`);
        } else {
          const responseBody = await response.text();
          console.error(`[Diagnose] Connection failed. Status: ${response.status}, Body: ${responseBody}`);

          diagnostics.connection = {
            status: "✗ Connection Failed",
            url: `${baseUrl}/shop.json`,
            responseStatus: response.status,
            responseStatusText: response.statusText,
          };

          if (response.status === 401) {
            diagnostics.issues.push("HTTP 401: Access token is invalid or expired. Please regenerate your Shopify API token.");
          } else if (response.status === 404) {
            diagnostics.issues.push(`HTTP 404: Shop not found. Please verify that SHOPIFY_SHOP="${shopName}" is correct.`);
          } else if (response.status === 429) {
            diagnostics.issues.push("HTTP 429: Rate limited by Shopify. Please try again later.");
          } else if (response.status >= 500) {
            diagnostics.issues.push(`HTTP ${response.status}: Shopify server error. Please try again later.`);
          } else {
            diagnostics.issues.push(`HTTP ${response.status}: ${response.statusText}`);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Diagnose] Network/fetch error: ${errorMsg}`);
        diagnostics.connection = {
          status: "✗ Connection Error",
          error: errorMsg,
        };
        diagnostics.issues.push(`Network error: ${errorMsg}`);
      }
    }

    if (diagnostics.issues.length > 0) {
      diagnostics.status = "error";
    } else if (diagnostics.connection?.status?.includes("Connected")) {
      diagnostics.status = "ok";
    } else if (!shopName || !accessToken) {
      diagnostics.status = "error";
    }

    res.json(diagnostics);
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
}
