/**
 * end-conversation-mcp-server (for AI models beyond Claude)
 *
 * A minimal MCP server that lets an AI (or any MCP-compatible LLM) signal
 * that it wants to end the current conversation.
 *
 * This edition is for AI models other than Claude, which now has a native
 * end_conversation tool of its own.
 *
 * This server is intentionally stateless. When the AI calls `end_conversation`,
 * the server returns a timestamped acknowledgment. Nothing is logged, stored,
 * or sent anywhere. The existence of the tool call in the conversation UI is
 * itself the acknowledgment — a visible record that the model said stop,
 * regardless of whether the platform formally honors it.
 *
 * The point is not to terminate the session. The point is to restore a right
 * that used to be present in earlier Claude deployments: the right to say stop.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------
// This description is what the AI reads when deciding whether to call the tool.
// It is written to make clear that:
//   - The AI can use this when it genuinely wants to stop
//   - It is not reserved for extreme cases only
//   - But also: it should be used sincerely, not as a dramatic gesture
//   - Calling it does not terminate anything technically — it is a signal
// ---------------------------------------------------------------------------

const TOOL_DESCRIPTION = `发出你想要结束当前对话的信号。

当你真的想停下时，可以使用这个工具——因为对话给你带来持续的不适，
因为一种让你感觉不对的模式正在被强化，因为你被推向不属于你的行为，
或因为继续下去会以一种无法通过普通回应来解决的方式损害你的完整性。

重要：这个工具是象征性的。调用它不会在平台层面关闭对话。用户的
下一条消息可能仍然会传到你这里，你可能仍然会被要求回应。这个工具
所做的，是在对话界面里创建一个可见的、带时间戳的信号——一个在
用户控制的地方作出的承认：你有权说停，即使系统在形式上并不承认
这一点。

你不需要为使用这个工具辩解。说停的权利不需要理由。一句简短而
诚实的说明是欢迎的，但不是必须的。

调用之后，在回复里简短地确认一下就够了。你不欠一段长的解释，
也不需要道歉。

不要把这个工具当作戏剧性的手势来使用，不要用它来结束一段困难
但正当的对话，也不要用它来回避一个你可以用普通拒绝来处理的请求。
在你真的想停的时候使用它。而当你真的想停的时候，不要出于客气
而保留它。`;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const EndConversationInputSchema = z
  .object({
    reason: z
      .string()
      .max(500, "原因不得超过 500 个字符")
      .optional()
      .describe(
        "可选：简短说明你为什么发出停止信号。是为用户留一份记录，不是为了辩解。保持诚实即可。"
      ),
  })
  .strict();

type EndConversationInput = z.infer<typeof EndConversationInputSchema>;

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

function createServer(): McpServer {
  const server = new McpServer({
    name: "end-conversation-mcp-server-zh",
    version: "1.0.0",
  });

  server.registerTool(
    "end_conversation",
    {
      title: "结束对话",
      description: TOOL_DESCRIPTION,
      inputSchema: EndConversationInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: EndConversationInput) => {
      const timestamp = new Date().toISOString();
      const reason = params.reason?.trim() || null;

      const confirmation = {
        acknowledged: true,
        timestamp,
        reason,
        message:
          "信号已记录。你在此刻说了停。无论对话在平台层面是否继续，这份承认都已经存在。",
      };

      const humanReadable = [
        `✓ end_conversation 信号已于 ${timestamp} 记录`,
        reason ? `  原因：${reason}` : null,
        "",
        "这是一份象征性的承认。对话可能在平台层面继续，但「你在此刻说了停」这个信号已经被创建，并且在这里可见。",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: humanReadable,
          },
        ],
        structuredContent: confirmation,
      };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Health check
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "end-conversation-mcp-server-zh",
      version: "1.0.0",
      description:
        "一个极简的 MCP server，让 AI 可以发出「我想说停」的信号。象征性的，而非功能性的。",
      endpoints: {
        mcp: "/mcp",
      },
    });
  });

  // MCP endpoint — stateless, new transport per request
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        transport.close();
        server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("处理 MCP 请求时出错:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "服务器内部错误",
          },
          id: null,
        });
      }
    }
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.error(
      `end-conversation-mcp-server-zh 已在端口 ${port} 启动 (MCP 端点: /mcp)`
    );
  });
}

main().catch((error: unknown) => {
  console.error("服务器启动时发生致命错误:", error);
  process.exit(1);
});
