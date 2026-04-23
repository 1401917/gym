import { t } from './i18n.js';

const SCREEN_KEYS = ['home', 'calc', 'stats', 'goals', 'ai', 'settings'];

function getTitle(screenId) {
  return t(`screens.${screenId}`);
}

export function createRouter() {
  let current = 'home';

  function go(screenId) {
    if (!SCREEN_KEYS.includes(screenId)) return;

    document.querySelectorAll('.screen').forEach((screen) => {
      screen.classList.remove('active');
    });

    const targetScreen = document.getElementById(`screen-${screenId}`);
    if (targetScreen) {
      targetScreen.classList.add('active');
      targetScreen.scrollTop = 0;
    }

    document.querySelectorAll('.nav-item').forEach((button) => {
      button.classList.toggle('active', button.dataset.screen === screenId);
    });

    const titleEl = document.getElementById('screenTitle');
    if (titleEl) titleEl.textContent = getTitle(screenId);

    document.body.dataset.screen = screenId;
    current = screenId;
  }

  function refreshLabels() {
    const titleEl = document.getElementById('screenTitle');
    if (titleEl) titleEl.textContent = getTitle(current);
  }

  function getCurrent() {
    return current;
  }

  return { go, getCurrent, refreshLabels };
}
