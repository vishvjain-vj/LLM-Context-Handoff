// Replace with your free Gemini API key from Google AI Studio
const GEMINI_API_KEY = "AIzaSyDSB9NPVjE-H7oslC3u7d8_M0WEe*****";
 

document.getElementById('grabContext').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  statusDiv.style.color = "#666";
  statusDiv.innerText = "Scanning full history...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      statusDiv.style.color = "red";
      statusDiv.innerText = "No active tab found.";
      return;
    }

    // Helper function to handle the async execution inside the tab safely
    const executeScriptAsync = (tabId, scriptFunc) => {
      return new Promise((resolve, reject) => {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: scriptFunc
        }, (results) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(results);
          }
        });
      });
    };

    // Step 1: Wait completely for the scrolling scanner to finish
    const results = await executeScriptAsync(tab.id, extractOnlyChatDialogueAsync);
    
    if (!results || !results[0] || !results[0].result) {
      statusDiv.style.color = "red";
      statusDiv.innerText = "Could not parse history.";
      return;
    }

    const cleanDialogue = results[0].result;
    statusDiv.style.color = "#666";
    statusDiv.innerText = "Extracting semantic meaning...";

    // Step 2: Pass the fully stitched text to the middleware LLM
    const semanticSummary = await compressChatLog(cleanDialogue);
    
    // Step 3: Copy to clipboard
    await navigator.clipboard.writeText(semanticSummary);
    statusDiv.style.color = "green";
    statusDiv.innerText = "Full Capsule Copied!";

  } catch (err) {
    // This catch block will now catch errors properly without breaking
    statusDiv.style.color = "red";
    statusDiv.innerText = "Error occurred.";
    console.error("Handoff Error Details:", err);
  }
});

// The async function injected into the webpage DOM
async function extractOnlyChatDialogueAsync() {
  // Find scrolling container
  let scrollContainer = document.querySelector('main') || document.querySelector('.overflow-y-auto') || window;
  const allDivs = document.querySelectorAll('div');
  for (let div of allDivs) {
    const style = window.getComputedStyle(div);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && div.scrollHeight > div.clientHeight) {
      scrollContainer = div;
      break;
    }
  }

  const initialScrollTop = scrollContainer === window ? window.scrollY : scrollContainer.scrollTop;

  // 1. Jump directly to the ABSOLUTE BOTTOM of the chat first
  if (scrollContainer === window) {
    window.scrollTo(0, document.body.scrollHeight);
  } else {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }
  
  // Wait for elements to load
  await new Promise(r => setTimeout(r, 400));

  let orderedMessages = [];
  let seenTexts = new Set();
  const selectors = [
    '[data-message-author-role]', 
    '.font-claude-message, [data-testid="user-message"]', 
    'message-content, .message-text'
  ].join(', ');

  const maxScanSteps = 100; 
  const stepDistance = scrollContainer === window ? window.innerHeight : scrollContainer.clientHeight;
  let previousScrollPos = -1;

  for (let i = 0; i < maxScanSteps; i++) {
    let elements = document.querySelectorAll(selectors);
    let currentBatch = [];
    
    // Read elements Top-Down in the current viewport
    elements.forEach(el => {
      let role = "Participant";
      if (el.getAttribute('data-message-author-role') === 'user' || el.closest('[data-testid="user-message"]')) {
        role = "USER";
      } else if (el.getAttribute('data-message-author-role') === 'assistant' || el.classList.contains('font-claude-message')) {
        role = "ASSISTANT";
      }
      
      const text = el.innerText.trim();
      if (text && !seenTexts.has(text)) {
        seenTexts.add(text);
        currentBatch.push({ role, text });
      }
    });

    // 2. Prepend the new batch so chronological order is perfectly maintained
    orderedMessages = currentBatch.concat(orderedMessages);

    const currentPos = scrollContainer === window ? window.scrollY : scrollContainer.scrollTop;
    
    // SMART BREAK: Stops if we hit the absolute top (0) or if scroll stops moving
    if (currentPos === 0 || currentPos === previousScrollPos) break; 
    
    previousScrollPos = currentPos;

    // 3. Scroll UPWARDS to fetch older history
    if (scrollContainer === window) {
      window.scrollBy(0, -stepDistance);
    } else {
      scrollContainer.scrollBy(0, -stepDistance);
    }
    
    await new Promise(r => setTimeout(r, 200)); 
  }

  // Restore view back to where the user was
  if (scrollContainer === window) {
    window.scrollTo(0, initialScrollTop);
  } else {
    scrollContainer.scrollTop = initialScrollTop;
  }

  return orderedMessages.map(m => `${m.role}: ${m.text}`).join('\n\n');
}

// Middleware API call to Gemini
async function compressChatLog(rawDialogue) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const systemInstruction = `You are a context compressor middleware. You will receive a messy chronological dialogue transcript between a user and an LLM. 
Your job is to strip away all conversational fluff, repetitive errors, and code iterations. 
Synthesize the semantic meaning into a highly dense, token-optimized blueprint for a FRESH LLM to read.

Format your output exactly like this:
# SEMANTIC CONTEXT CAPSULE
- CORE OBJECTIVE: (1-2 sentences of what the user is trying to build/achieve)
- LOCKED CONSTRAINTS: (Tech stacks, style rules, or preferences agreed upon)
- COMPLETED SO FAR: (Bullet points of functional progress made)
- WHAT FAILED: (Things attempted that did not work, to avoid repeating)
- NEXT IMMEDIATE TASK: (Clear instruction for where the next LLM should start)`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `${systemInstruction}\n\n---RAW TRANSCRIPT---\n${rawDialogue}` }]
      }]
    })
  });

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// Close icon controller
document.getElementById('closePopup').addEventListener('click', () => {
    window.close();
});
