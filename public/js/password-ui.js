/**
 * Password field enhancements: a show/hide toggle and a live requirements
 * checklist. The checklist mirrors the server's validation exactly, so
 * rules read as guidance while typing instead of errors after submit.
 */
import { icon } from '/js/icons.js';

// Kept in sync with COMMON_PASSWORDS in src/validators/auth.validators.js.
const COMMON_PASSWORDS = new Set([
  'password1', 'password12', 'password123', 'password1234', 'passw0rd',
  'p@ssw0rd', 'p4ssword', 'abc12345', 'abcd1234', 'qwerty12', 'qwerty123',
  'qwerty1234', 'qwertyuiop1', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx',
  'qazwsx123', 'asdf1234', 'zxcv1234', 'iloveyou1', 'iloveyou2',
  'welcome1', 'welcome12', 'welcome123', 'admin123', 'admin1234',
  'letmein1', 'letmein123', 'monkey123', 'dragon123', 'sunshine1',
  'princess1', 'football1', 'baseball1', 'superman1', 'batman123',
  'trustno1', 'master123', 'hello123', 'freedom1', 'whatever1',
  'changeme1', 'temp1234', 'test1234', 'user1234', 'pass1234',
  'password2025', 'password2026', 'flavor123', 'color123', 'paint123',
]);

/** Wraps the input and adds an eye button that toggles visibility. */
export function addPasswordToggle(input) {
  if (!input || input.dataset.pwEnhanced) return;
  input.dataset.pwEnhanced = 'true';

  const wrap = document.createElement('div');
  wrap.className = 'password-field';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pw-toggle';
  button.setAttribute('aria-label', 'Show password');
  button.innerHTML = icon('eye', 18);
  button.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.innerHTML = icon(show ? 'eye-off' : 'eye', 18);
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  });
  wrap.appendChild(button);
}

const RULES = [
  { key: 'length', label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { key: 'letter', label: 'Contains a letter', test: (v) => /[a-zA-Z]/.test(v) },
  { key: 'number', label: 'Contains a number', test: (v) => /\d/.test(v) },
  {
    key: 'common',
    label: 'Not a commonly used password',
    test: (v) => v.length > 0 && !COMMON_PASSWORDS.has(v.toLowerCase()),
  },
];

/** Inserts a live checklist below the field; rules turn green as they pass. */
export function addPasswordChecklist(input) {
  if (!input) return;

  const list = document.createElement('ul');
  list.className = 'pw-checklist';
  list.innerHTML = RULES.map((rule) => `<li data-rule="${rule.key}">${rule.label}</li>`).join('');

  const anchor = input.closest('.password-field') || input;
  anchor.insertAdjacentElement('afterend', list);

  const update = () => {
    for (const rule of RULES) {
      list
        .querySelector(`[data-rule="${rule.key}"]`)
        .classList.toggle('is-met', rule.test(input.value));
    }
  };
  input.addEventListener('input', update);
  update();
}
