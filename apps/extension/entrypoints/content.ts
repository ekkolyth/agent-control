import { handleContentRequest } from '../src/content/handler'
import { createQuietDetector } from '../src/content/quiet'

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    const quiet = createQuietDetector(document)
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      handleContentRequest(msg, { doc: document, quiet }).then(sendResponse)
      return true
    })
  },
})
