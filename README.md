# Export-ChatGPT-Thread

Extracts the full text of a ChatGPT conversation and downloads it as a .txt file, working around the virtualized/lazy-loaded DOM that prevents Ctrl+A, Ctrl+C, and Ctrl+P from working properly on long threads.

## How to Use

1. Open the ChatGPT conversation you want to export.  
2. Scroll all the way to the top of the thread. Wait for older messages to finish loading—the topmost message should stop changing.  
3. Open DevTools (`F12` on Windows/Linux or `Cmd+Option+I` on Mac), then select the **Console** tab.  
4. If the console blocks pasting, type `allow pasting` and press Enter.  
5. Paste the entire script into the console and press Enter.  
6. In the overlay that appears, click **Start export**.  
7. Wait for the export to finish. The conversation will download automatically as a `.txt` file. 
