/**
 * Telegram handler for loading groups and testing notifications
 */

import { showStatus } from './form-helpers.js';

export interface TelegramChat {
  id: number | string;
  title?: string;
  username?: string;
  type: string;
}

/**
 * Load Telegram groups/chats
 */
export async function loadTelegramGroups(
  botToken: string,
  chatSelectEl: HTMLSelectElement,
  loadBtn?: HTMLButtonElement
): Promise<void> {
  if (!botToken) {
    showStatus('Please enter Bot Token first', 'error');
    return;
  }

  // Disable button and show loading state
  if (loadBtn) {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Loading...';
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error((error as any).description || 'Failed to fetch groups');
    }

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.description || 'Failed to fetch groups');
    }

    // Extract unique chats from updates
    const chatsMap = new Map<string | number, TelegramChat>();

    if (data.result && Array.isArray(data.result)) {
      data.result.forEach((update: any) => {
        if (update.message?.chat) {
          const chat = update.message.chat;
          const chatId = chat.id;
          const chatType = chat.type;

          // Only include groups and supergroups
          if (chatType === 'group' || chatType === 'supergroup') {
            if (!chatsMap.has(chatId)) {
              chatsMap.set(chatId, {
                id: chatId,
                title: chat.title || chat.username || `Group ${chatId}`,
                username: chat.username,
                type: chatType
              });
            }
          }
        }
      });
    }

    // Clear existing options except the first one
    chatSelectEl.innerHTML = '<option value="">Select a group or enter Chat ID manually</option>';

    if (chatsMap.size === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No groups found. Make sure the bot is added to groups and has received messages.';
      option.disabled = true;
      chatSelectEl.appendChild(option);
      showStatus('No groups found. Add the bot to a group and send a message to it.', 'error');
    } else {
      // Sort chats by title
      const chatsArray = Array.from(chatsMap.values()).sort((a, b) => {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB);
      });

      // Add options for each chat
      chatsArray.forEach(chat => {
        const option = document.createElement('option');
        option.value = String(chat.id);
        const displayName = chat.title || chat.username || `Chat ${chat.id}`;
        option.textContent = `${displayName} (${chat.type})`;
        chatSelectEl.appendChild(option);
      });

      showStatus(`Found ${chatsArray.length} group(s)`, 'success');
    }
  } catch (error) {
    showStatus('Error loading groups: ' + (error instanceof Error ? error.message : String(error)), 'error');
  } finally {
    // Re-enable button
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load Groups';
    }
  }
}

/**
 * Test Telegram notification
 */
export async function testTelegram(botToken: string, chatId: string): Promise<void> {
  if (!botToken || !chatId) {
    showStatus('Please fill in Bot Token and Chat ID', 'error');
    return;
  }

  try {
    const message = '✅ Test notification from Focus Saving extension';
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message
      })
    });

    if (response.ok) {
      showStatus('Test notification sent!', 'success');
    } else {
      const error = await response.json();
      showStatus('Error: ' + ((error as any).description || 'Invalid token or Chat ID'), 'error');
    }
  } catch (error) {
    showStatus('Error sending: ' + (error instanceof Error ? error.message : String(error)), 'error');
  }
}
