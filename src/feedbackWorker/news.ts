// The Ornus news file the control panel reads (src/panel/news.ts, NEWS_URL): served by this
// worker at ornus.ai/enhancer/news.json, so the panel's news slot reaches every installed
// Enhancer without a new release. Each item must pass the panel's own rules (newsItemsFrom:
// id a-z0-9-, titles ≤60, texts ≤140, en and ar, an https link on ornus.ai); a test checks it.
// Changing a text: edit here, run the tests, deploy the worker. A new announcement takes a new
// id, since users who closed an item never see that id again.
export const NEWS_FILE = {
  items: [
    {
      id: 'ornus-is-here',
      title: { en: 'Ornus is here', ar: 'Ornus متاح الآن' },
      text: {
        en: 'An AI workspace on VS Code: Claude and ChatGPT together, and a second model reviews every change. Free to start.',
        ar: 'مساحة عمل بالذكاء الاصطناعي على VS Code: Claude وChatGPT معًا، ونموذج ثانٍ يراجع كل تغيير. البداية مجانية.',
      },
      url: 'https://ornus.ai/download',
    },
  ],
}

/** GET /enhancer/news.json: the file above as JSON, cached briefly at the edge and in the editor's request. */
export function handleNews (request: Request): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ ok: false, error: 'method' }), { status: 405, headers: { 'content-type': 'application/json', allow: 'GET, HEAD' } })
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(NEWS_FILE), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  })
}
