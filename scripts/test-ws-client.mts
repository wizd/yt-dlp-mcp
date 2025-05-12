import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";

// 服务器 WebSocket 连接信息 (请根据您的服务器配置调整)
const SERVER_URL = "ws://localhost:9591/ws"; // 假设您的服务器运行在本地的 9591 端口，路径为 /ws
const API_KEY = ""; // 如果您的服务器配置了 API_KEY，请在此处填写

interface CallToolRequest {
  jsonrpc: "2.0";
  method: "callTool";
  id: string;
  params: {
    name: string;
    arguments: Record<string, any>;
  };
}

interface CallToolResponse {
  jsonrpc: "2.0";
  id: string; // 将会是 client_id:request_id 的形式
  result?: {
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

async function testDownloadVideo() {
  console.log(`尝试连接到 WebSocket 服务器: ${SERVER_URL}`);
  const ws = new WebSocket(SERVER_URL, {
    headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
  });

  const requestId = uuidv4(); // 为这个特定的请求生成唯一 ID

  ws.on("open", () => {
    console.log("成功连接到 WebSocket 服务器。");

    const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"; // 测试视频 URL
    const resolution = "720p"; // 测试分辨率

    const callToolPayload: CallToolRequest = {
      jsonrpc: "2.0",
      method: "callTool",
      id: requestId, // 客户端生成的请求 ID
      params: {
        name: "download_video",
        arguments: {
          url: videoUrl,
          resolution: resolution,
        },
      },
    };

    console.log(
      "发送 CallToolRequest:",
      JSON.stringify(callToolPayload, null, 2)
    );
    ws.send(JSON.stringify(callToolPayload));
  });

  ws.on("message", (data) => {
    console.log("收到来自服务器的消息:");
    try {
      const message = JSON.parse(data.toString()) as CallToolResponse;
      console.log(JSON.stringify(message, null, 2));

      // 检查响应ID是否与请求ID匹配 (注意服务器端会加上 clientID 前缀)
      // message.id 的格式会是 "some-client-uuid:requestId"
      if (message.id && message.id.endsWith(requestId)) {
        if (message.result && !message.result.isError) {
          console.log("\n测试成功！视频下载工具调用成功。");
          console.log("服务器响应内容:", message.result.content[0]?.text);
        } else if (message.result && message.result.isError) {
          console.error("\n测试失败！工具调用时发生错误:");
          console.error("错误信息:", message.result.content[0]?.text);
        } else if (message.error) {
          console.error("\n测试失败！服务器返回错误:");
          console.error(
            `错误代码: ${message.error.code}, 消息: ${message.error.message}`
          );
        }
      } else {
        console.warn(
          "收到的消息 ID 与请求 ID 不完全匹配或没有 ID，可能不是针对此请求的直接响应。"
        );
      }
    } catch (e) {
      console.error("解析服务器消息失败:", e);
      console.log("原始消息数据:", data.toString());
    }
    ws.close(); // 完成测试后关闭连接
  });

  ws.on("error", (error) => {
    console.error("WebSocket 连接发生错误:", error.message);
    // 可以在这里尝试重新连接或进行其他错误处理
  });

  ws.on("close", (code, reason) => {
    console.log(
      `WebSocket 连接已关闭。代码: ${code}, 原因: ${
        reason ? reason.toString() : "无"
      }`
    );
  });
}

// 执行测试
testDownloadVideo().catch((err) => {
  console.error("执行测试时发生未捕获的错误:", err);
});
