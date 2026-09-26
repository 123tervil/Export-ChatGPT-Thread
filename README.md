# Export-ChatGPT-Thread

Extracts the full text of a ChatGPT conversation and downloads it as a .txt file, working around the virtualized/lazy-loaded DOM that prevents Ctrl+A, Ctrl+C, and Ctrl+P from working properly on long threads.

# The problem

Long ChatGPT threads use a virtualized, lazy-loaded transcript: the browser only keeps a limited window of messages in the page at a time. That is why normal Ctrl+A/Ctrl+C, Print, and our first DOM-copy scripts captured only the currently mounted portion of the conversation, producing truncated exports.

# Why this works

This script targets ChatGPT’s actual scroll container, then works around virtualization by first ensuring the oldest messages have been loaded and sweeping through the thread in small increments. At every scroll position it finds each You said: / ChatGPT said: message boundary, extracts the surrounding message content, deduplicates overlapping messages, keeps them in chronological order, and downloads the compiled result as a local .txt file.

The important prerequisite is that the user scrolls fully to the top and waits for older messages to load before starting the script; otherwise those earlier messages do not yet exist in the browser DOM for any script to extract.

## How to Use

1. Open the ChatGPT conversation you want to export.  
2. Scroll all the way to the top of the thread. Wait for older messages to finish loading—the topmost message should stop changing.  
3. Open DevTools (`F12` on Windows/Linux or `Cmd+Option+I` on Mac), then select the **Console** tab.  
4. If the console blocks pasting, type `allow pasting` and press Enter.  
5. Paste the entire script into the console and press Enter.  
6. In the overlay that appears, click **Start export**.  
7. Wait for the export to finish. The conversation will download automatically as a `.txt` file. 
