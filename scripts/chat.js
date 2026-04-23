import { t } from './i18n.js';
import { buildChatReplyFromIntent } from './offline-ai.js';

let chatLanguageListenerController = null;

const CHAT_STATES = {
  root: {
    options: [
      { type: 'state', state: 'weights', labelKey: 'ai.menu.proteinTarget' },
      { type: 'intent', intent: 'high-protein', labelKey: 'ai.suggestion.highProtein' },
      { type: 'intent', intent: 'chicken-calories', labelKey: 'ai.suggestion.chickenCalories' },
      { type: 'intent', intent: 'protein-timing', labelKey: 'ai.suggestion.proteinTiming' },
      { type: 'state', state: 'supplements', labelKey: 'ai.menu.supplements' },
      { type: 'intent', intent: 'egg-protein', labelKey: 'ai.suggestion.eggProtein' },
    ],
  },
  weights: {
    promptKey: 'ai.prompt.proteinWeight',
    options: [50, 60, 75, 90, 110].map((weight) => ({
      type: 'intent',
      intent: 'protein-target',
      labelKey: 'ai.weightOption',
      values: { value: weight },
      userText: `${weight} kg`,
      nextState: 'root',
    })).concat([
      { type: 'state', state: 'root', labelKey: 'ai.option.backToTopics' },
    ]),
  },
  supplements: {
    promptKey: 'ai.prompt.supplements',
    options: [
      { type: 'intent', intent: 'bcaa', labelKey: 'ai.suggestion.bcaa', nextState: 'root' },
      { type: 'intent', intent: 'creatine', labelKey: 'ai.suggestion.creatine', nextState: 'root' },
      { type: 'state', state: 'root', labelKey: 'ai.option.backToTopics' },
    ],
  },
};

function sanitizeMessages(messages) {
  return Array.isArray(messages)
    ? messages
        .filter((item) => item && typeof item.text === 'string')
        .map((item) => ({
          role: item.role === 'user' ? 'user' : 'assistant',
          text: item.text,
        }))
        .slice(-30)
    : [];
}

export function createChat(showToastFn, initialSnapshot = null, onSnapshotChange = () => {}) {
  const messagesEl = document.getElementById('chatMessages');
  const suggestionsEl = document.getElementById('chatSuggestions');
  let currentState = initialSnapshot?.currentState || 'root';
  let messages = sanitizeMessages(initialSnapshot?.messages);

  chatLanguageListenerController?.abort();
  chatLanguageListenerController = typeof AbortController === 'function'
    ? new AbortController()
    : null;
  const listenerController = chatLanguageListenerController;
  const listenerOptions = chatLanguageListenerController
    ? { signal: chatLanguageListenerController.signal }
    : undefined;

  function persistSnapshot() {
    onSnapshotChange({
      currentState,
      messages: messages.slice(-30),
    });
  }

  function appendBubble(text, isUser, persist = true) {
    const message = {
      role: isUser ? 'user' : 'assistant',
      text: String(text || '').trim(),
    };

    if (message.text) {
      messages.push(message);
      messages = messages.slice(-30);
      if (persist) persistSnapshot();
    }

    const div = document.createElement('div');
    div.className = `chat-bubble ${isUser ? 'user-bubble' : 'bot-bubble'}`;
    div.style.whiteSpace = 'pre-line';
    div.textContent = message.text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function appendTyping() {
    const div = document.createElement('div');
    div.className = 'chat-bubble bot-bubble typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function renderStoredMessages() {
    if (!messagesEl || !messages.length) return;

    messagesEl.innerHTML = '';
    messages.forEach((message) => {
      const div = document.createElement('div');
      div.className = `chat-bubble ${message.role === 'user' ? 'user-bubble' : 'bot-bubble'}`;
      div.style.whiteSpace = 'pre-line';
      div.textContent = message.text;
      messagesEl.appendChild(div);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function bootstrapWelcomeIfNeeded() {
    if (messages.length) return;
    const welcomeText = messagesEl?.querySelector('.bot-bubble')?.textContent?.trim() || t('ai.welcome');
    messages = [{ role: 'assistant', text: welcomeText }];
    persistSnapshot();
  }

  function getOptionLabel(option) {
    return t(option.labelKey, option.values || {});
  }

  function renderOptions(stateId = 'root', persist = true) {
    const state = CHAT_STATES[stateId] || CHAT_STATES.root;
    currentState = stateId in CHAT_STATES ? stateId : 'root';

    if (persist) persistSnapshot();
    if (!suggestionsEl) return;

    suggestionsEl.innerHTML = '';
    state.options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'suggestion-chip';
      button.textContent = getOptionLabel(option);
      button.addEventListener('click', () => {
        handleOption(option);
      });
      suggestionsEl.appendChild(button);
    });
  }

  async function handleIntentOption(option) {
    bootstrapWelcomeIfNeeded();

    const userLabel = getOptionLabel(option);
    appendBubble(userLabel, true);

    const typingEl = appendTyping();
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      const answer = buildChatReplyFromIntent(option.intent, option.userText || userLabel).trim();
      typingEl.remove();
      appendBubble(answer, false);
      renderOptions(option.nextState || 'root');
    } catch {
      typingEl.remove();
      showToastFn?.(t('chat.errorToast'));
      appendBubble(t('chat.errorBubble'), false);
      renderOptions('root');
    }
  }

  async function handleStateOption(option) {
    bootstrapWelcomeIfNeeded();

    const nextState = CHAT_STATES[option.state] || CHAT_STATES.root;
    appendBubble(getOptionLabel(option), true);

    if (!nextState.promptKey) {
      renderOptions(option.state);
      return;
    }

    const typingEl = appendTyping();
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    typingEl.remove();
    appendBubble(t(nextState.promptKey), false);
    renderOptions(option.state);
  }

  function handleOption(option) {
    if (option.type === 'intent') {
      handleIntentOption(option);
      return;
    }

    handleStateOption(option);
  }

  if (messages.length) {
    renderStoredMessages();
  }

  document.addEventListener('app-language-change', () => {
    renderOptions(currentState, false);
  }, listenerOptions);

  renderOptions(currentState, false);

  return {
    renderOptions: () => renderOptions(currentState),
    destroy: () => {
      listenerController?.abort();
      if (chatLanguageListenerController === listenerController) {
        chatLanguageListenerController = null;
      }
    },
  };
}
