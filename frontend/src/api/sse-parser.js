/**
 * SSE (Server-Sent Events) 流解析器
 * 将 ReadableStream 按 SSE 协议逐事件解析，回调 delta/done/error
 * @module api/sse-parser
 */

/**
 * 解析 SSE 流并触发回调
 * @param {ReadableStream} stream - fetch API 返回的 response.body
 * @param {Object} callbacks - 事件回调
 * @param {function(string):void} [callbacks.onDelta] - 增量文本回调
 * @param {function(Object):void} [callbacks.onDone] - 完成事件回调
 * @param {function(Object):void} [callbacks.onError] - 错误事件回调
 */
export async function parseSSEStream(stream, callbacks) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('event: ')) {
          eventType = trimmed.slice(7).trim();
        } else if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            switch (eventType) {
              case 'delta':
                callbacks.onDelta && callbacks.onDelta(data.chunk);
                break;
              case 'done':
                callbacks.onDone && callbacks.onDone(data);
                break;
              case 'error':
                callbacks.onError && callbacks.onError(data);
                break;
            }
          } catch (e) {
            console.warn('[SSE] 解析 data 失败:', trimmed, e);
          }
          eventType = '';
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
