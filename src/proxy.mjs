const TARGET_HOST = 'generativelanguage.googleapis.com';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 处理 CORS (为了兼容浏览器端调用)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': '*',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    // 2. 替换域名
    url.hostname = TARGET_HOST;
    url.protocol = 'https:';
    url.port = '';

    // 3. 构造请求
    const newRequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
      redirect: 'follow',
      // body 只有在非 GET/HEAD 方法时才透传
      body: request.body, 
    };

    // 4. 清理头部 (防止 Google 拒绝)
    // 务必删除 Host，否则 Google 会认为是中间人攻击或路由错误
    newRequestInit.headers.delete('Host');
    newRequestInit.headers.delete('cf-connecting-ip');
    newRequestInit.headers.delete('cf-ipcountry');
    newRequestInit.headers.delete('cf-ray');
    newRequestInit.headers.delete('cf-visitor');
    // 如果 SDK 发送了 accept-encoding，可能会导致数据被压缩，worker透传时可能出问题，
    // 删除它让 Google 返回原始内容，或者由 CF 自动处理压缩，通常建议删除。
    // newRequestInit.headers.delete('accept-encoding'); 

    // 5. 发起请求 (不加 try-catch)
    // 即使 Google 返回 400/500，fetch 也会 resolve，response.body 里包含 Google 的原始错误信息
    const response = await fetch(url.toString(), newRequestInit);

    // 6. 构造响应并流式透传
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });

    // 7. 补全 CORS
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Headers', '*');

    return newResponse;
  },
};