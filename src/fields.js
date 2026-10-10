// Classic content-script module: kept dependency-free so it can run on every HTTPS page.
globalThis.VerificationFields = (() => {
  const WORDS = /(?:verif(?:ication|y)?|security\s*code|confirm(?:ation)?\s*code|one[\s-]*time(?:\s*(?:code|password|pin))?|auth(?:entication)?\s*code|enter\s*(?:the\s*)?(?:(?:6|4|8)[\s-]*digit\s*)?code|email\s*code|\botp\b|\b2fa\b|pin\s*code|passcode|access\s*code|withdrawal\s*code|login\s*code|(?:6|4|8)[\s-]*digit(?:\s*(?:code|pin|verification))?|digit\s*code|код\s*(?:подтверждения|верификации|безопасности|для\s*(?:входа|вывода|доступа|подтверждения)|вывода|авторизации|доступа)|подтверд(?:ите|ение)\s*(?:вывод|вход|действие|операцию)?|одноразов(?:ый|ого)\s*(?:код|пароль)|проверочн(?:ый|ого)\s*код|введите\s*код|получить\s*код|запросить\s*код|код\s*(?:из|с|по|на)\s*(?:письма|почты|почту|e[\s-]?mail|эл\.?\s*почт[а-я]*)|(?:6|4|8)[\s-]*значн(?:ый|ого)\s*код|cod\s*(?:de\s*)?(?:verificare|confirmare|securitate|otp)|introduceți\s*cod|código\s*(?:de\s*)?(?:verificación|confirmación|seguridad)|code\s*(?:de\s*)?(?:vérification|confirmation|sécurité)|bestätigungscode|sicherheitscode|验证码)/i;
  const WEAK = /(?:code|код|\bcod\b)/i;
  const EMAIL = /(?:e[\s-]?mail|эл\.?\s*почт[а-я]*|почт[а-я]+|письм[а-я]+|courriel|correo|posta\s*electronic|cod\s*(?:din|primit\s*prin)\s*email|[a-z0-9._%*+-]+@(?:[a-z0-9*.-]+\.)+[a-z*]{2,}|gm[\*a-z0-9]*il|yand[\*a-z0-9]*x)/i;
  const AUTHENTICATOR = /(?:authenticator|authentication\s*app|authy|\btotp\b|\b2fa\b|\bmfa\b|two[\s-]*factor|passkey|security\s*key|yubikey|аутентификатор[а-я]*|аутентификаци[а-я]*|гугл[\s-]*аут[а-я]*|яндекс[\s-]*ключ|ключ\s*безопасности|аппаратн[а-я]*\s*ключ|код\s*из\s*приложения|приложени[яе]\s*(?:для\s*)?аутентификаци|aplicaț(?:ia|iei)\s*de\s*autentificare)/i;
  const VERIFICATION = /(?:верификаци[яи]|проверка\s*(?:безопасности|почты)|подтверждение|verification|verify|verificare|verificación|vérification|bestätigung|验证)/i;
  const RESEND = /(?:resend|send\s*(?:again|code)|отправить\s*повторно|повторн[а-я]*\s*(?:отправ|код)|retrimit|reenviar|renvoyer)/i;
  const ALTERNATIVE = /(?:switch|instead|use\s*(?:another|a different)|другой\s*способ|с\s*помощью|переключ|недоступ|unavailable)/i;
  const SMS = /(?:\bsms\b|text\s*message|phone\s*code|код\s*из\s*смс|cod\s*prin\s*sms)/i;
  const allowedType = /^(?:text|tel|number|password|search)$/;
  const closedRoots = [];
  let visibilityCache = null;
  if (typeof Element !== 'undefined' && Element.prototype && !Element.prototype.__csPatched) {
    const origAttach = Element.prototype.attachShadow;
    if (typeof origAttach === 'function') {
      Element.prototype.attachShadow = function(init) {
        const shadow = origAttach.call(this, init);
        if (init?.mode === 'closed') closedRoots.push(shadow);
        return shadow;
      };
      Element.prototype.__csPatched = true;
    }
  }

  function isEditableElement(el) {
    if (!el || el.disabled || el.readOnly || el.isConnected === false) return false;
    if (el.tagName === 'INPUT') return allowedType.test(el.type || 'text');
    return el.isContentEditable || el.getAttribute?.('contenteditable') === 'true' || el.getAttribute?.('contenteditable') === '';
  }

  function otpCell(input) {
    if (!visible(input)) return false;
    if (input.maxLength === 1) return true;
    if ((input.isContentEditable || input.getAttribute?.('contenteditable') === 'true') && input.textContent.length <= 1 && /(?:otp|cell|digit|slot|box)/i.test(`${input.className || ''} ${input.getAttribute?.('data-cell') || ''}`)) return true;
    return false;
  }

  function visible(input) {
    if (visibilityCache?.has(input)) return visibilityCache.get(input);
    const result = computeVisible(input);
    visibilityCache?.set(input, result);
    return result;
  }

  function computeVisible(input) {
    if (!isEditableElement(input)) return false;
    for (let el = input; el; el = el.parentElement || el.getRootNode?.().host) {
      if (el.hidden || el.hasAttribute?.('inert')) return false;
      const style = input.ownerDocument?.defaultView?.getComputedStyle(el);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    }
    if (input.getAttribute?.('aria-hidden') !== 'true') return true;
    // input-otp keeps the real, focusable input over its decorative slots.
    // Require a strong OTP signal before treating an aria-hidden input as usable.
    const attrs = attributeText(input);
    const parent = input.parentElement;
    return input.tabIndex >= 0 && (/one-time-code/i.test(input.autocomplete ?? '') ||
      (WORDS.test(attrs) && /(?:otp|code|verification|slot)/i.test(`${parent?.className ?? ''} ${parent?.getAttribute?.('data-slot') ?? ''}`)));
  }

  function attributeText(input) {
    return [input.name, input.id, input.placeholder, input.autocomplete, input.inputMode,
      input.pattern, input.getAttribute?.('aria-label'), input.getAttribute?.('data-testid'), input.getAttribute?.('data-qa')].filter(Boolean).join(' ');
  }

  function contextParts(input) {
    const parts = [];
    if (input.labels) for (const l of input.labels) parts.push(l.textContent);
    const labelledBy = `${input.getAttribute?.('aria-labelledby') ?? ''} ${input.getAttribute?.('aria-describedby') ?? ''}`.trim();
    if (labelledBy && input.ownerDocument) {
      for (const id of labelledBy.split(/\s+/)) {
        const el = input.ownerDocument.getElementById(id);
        if (el) parts.push(el.textContent);
      }
    }
    let current = input;
    for (let depth = 0; current && depth < 8; depth++) {
      const parent = current.parentElement || current.parentNode;
      if (!parent || parent.nodeType === 9 /* document */) break;
      let prev = current.previousElementSibling;
      while (prev) {
        if (prev.matches?.('input,[contenteditable]') || prev.querySelector?.('input,[contenteditable]')) break;
        if (!prev.matches?.('a,button,[role="button"]') || !ALTERNATIVE.test(prev.textContent)) parts.push(prev.textContent);
        prev = prev.previousElementSibling;
      }
      const inputsInParent = parent.querySelectorAll ? parent.querySelectorAll('input') : [];
      if (inputsInParent.length <= 1) {
        const labels = parent.querySelectorAll ? parent.querySelectorAll('label, [class*="label" i], [class*="title" i], legend') : [];
        for (const el of labels) {
          if (!el.querySelector('input') && !el.contains(input)) {
            if (!el.matches('a,button,[role="button"]') || !ALTERNATIVE.test(el.textContent)) parts.push(el.textContent);
          }
        }
      }
      const others = [...inputsInParent].filter(el => el !== input);
      const possibleCells = inputsInParent.length >= 4 && inputsInParent.length <= 8 && [...inputsInParent].every(el => el.maxLength === 1 || (el.maxLength < 0 && (el.value ?? '').length <= 1));
      if (others.some(el => !otpCell(el)) && !possibleCells) break;
      if (parent.matches?.('form,dialog,[role="dialog"],fieldset')) break;
      current = parent.host || parent;
    }
    const directParent = input.parentElement || input.parentNode;
    if (directParent && directParent.nodeType !== 9) {
      const text = [...directParent.childNodes].filter(el => el.nodeType === 3 || (!el.matches?.('a,button,[role="button"]') || !ALTERNATIVE.test(el.textContent))).map(el => el.textContent).join(' ');
      parts.push(text);
    }
    return parts.filter(Boolean).map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function contextText(input) {
    return contextParts(input).join(' ').slice(0, 600);
  }

  function score(input) {
    if (!visible(input)) return -1;
    const attrs = attributeText(input);
    if (/(?:\bcvv\b|\bcvc\b|card[-_\s]*(?:number|security)|credit[-_\s]*card|captcha|promo|coupon|postal|zip[-_\s]*code)/i.test(attrs)) return -1;
    // Login forms mention a future OTP beside the email-address field.
    // That context must not turn the account identifier into a code target.
    const identifier = `${input.name ?? ''} ${input.id ?? ''} ${input.getAttribute?.('aria-label') ?? ''}`;
    const codeShape = /^(?:numeric|decimal)$/i.test(input.inputMode ?? '') || (input.maxLength >= 4 && input.maxLength <= 8);
    if (!codeShape && !WORDS.test(attrs) && !WEAK.test(attrs) && (/(?:email|username|current-password|new-password)/i.test(input.autocomplete ?? '') ||
      /(?:^|[-_\s])(?:e-?mail|email-address|username|password)(?:$|[-_\s])/i.test(identifier) ||
      /(?:enter|введите|your|ваш).*?(?:e[\s-]?mail|почт|password|пароль)/i.test(input.placeholder ?? ''))) return -1;
    const context = contextText(input);
    const verificationContext = WORDS.test(context) || ((VERIFICATION.test(context) || WEAK.test(context)) && (EMAIL.test(context) || AUTHENTICATOR.test(context) || SMS.test(context)));
    const deliveryContext = EMAIL.test(context) && RESEND.test(input.parentElement?.parentElement?.textContent ?? '');
    if (!WORDS.test(attrs) && !WEAK.test(attrs) && !/one-time-code/i.test(input.autocomplete ?? '') && !verificationContext && !deliveryContext && !WEAK.test(context)) return -1;
    let value = 0;
    if (/one-time-code/i.test(input.autocomplete ?? '')) value += 7;
    if (WORDS.test(attrs)) value += 5;
    else if (WEAK.test(attrs)) value += 2;
    if (verificationContext) value += 4;
    else if (WEAK.test(context)) value += 1;
    if (!verificationContext && deliveryContext) value += 4;
    if (/^(?:numeric|decimal)$/i.test(input.inputMode ?? '')) value += 1;
    if (input.maxLength >= 4 && input.maxLength <= 8) value += 1;
    if (input.minLength >= 4 && input.minLength <= 8) value += 1;
    if (/\\d|\[0-9\]/.test(input.pattern ?? '')) value += 1;
    if (input.type === 'password') value -= 2;
    try { if (input === input.ownerDocument?.activeElement) value += 3; } catch {}
    return value;
  }

  function channel(input, groupContext = '') {
    const label = input.labels ? [...input.labels].map(x => x.textContent).join(' ') : '';
    const explicit = `${attributeText(input)} ${label}`;
    if (AUTHENTICATOR.test(explicit)) return 'authenticator';
    if (SMS.test(explicit)) return 'sms';
    if (EMAIL.test(explicit)) return 'email';
    for (const nearby of [...contextParts(input), groupContext]) {
      if (AUTHENTICATOR.test(nearby) && !EMAIL.test(nearby)) return 'authenticator';
      if (SMS.test(nearby) && !EMAIL.test(nearby)) return 'sms';
      if (EMAIL.test(nearby)) return 'email';
    }
    return 'unknown';
  }

  function groupFor(input) {
    if (!visible(input)) return null;
    let ancestor = input.parentElement;
    for (let depth = 0; ancestor && depth < 5; depth++, ancestor = ancestor.parentElement) {
      const inputs = [...ancestor.querySelectorAll('input, [contenteditable="true"], [contenteditable=""]')].filter(candidate => visible(candidate));
      if (inputs.length < 4 || inputs.length > 8 || !inputs.includes(input)) continue;
      const cellLike = inputs.every(candidate => candidate.maxLength === 1 || (candidate.maxLength < 0 && (candidate.value ?? candidate.textContent).length <= 1) || ((candidate.isContentEditable || candidate.getAttribute?.('contenteditable') === 'true') && candidate.textContent.length <= 1));
      if (!cellLike) continue;
      const context = [ancestor.textContent, contextText(inputs[0]), ancestor.getAttribute?.('aria-label'), ancestor.previousElementSibling?.textContent,
        ancestor.parentElement?.previousElementSibling?.textContent, ancestor.parentElement?.parentElement?.previousElementSibling?.textContent].filter(Boolean).join(' ').slice(0, 500);
      const strongContext = WORDS.test(context) || inputs.some(candidate => WORDS.test(attributeText(candidate)) || candidate.autocomplete === 'one-time-code');
      if (!strongContext) continue;
      const scoreValue = Math.max(...inputs.map(score)) + 6;
      if (scoreValue >= 6) return { type: 'group', inputs, score: scoreValue, anchor: inputs.at(-1), context, channel: channel(inputs[0], context) };
    }
    return null;
  }

  function roots(root = document) {
    const found = [root];
    for (let index = 0; index < found.length; index++) {
      for (const element of found[index].querySelectorAll('*')) {
        const shadow = element.shadowRoot || element.renderRoot || element._shadowRoot;
        if (shadow && !found.includes(shadow)) found.push(shadow);
      }
    }
    for (const shadow of closedRoots) {
      if (shadow?.host?.isConnected && !found.includes(shadow)) found.push(shadow);
    }
    return found;
  }

  function detect(root = document) {
    visibilityCache = new WeakMap();
    try { return detectFields(root); } finally { visibilityCache = null; }
  }

  function detectFields(root) {
    const inputs = roots(root).flatMap(part => [...part.querySelectorAll('input, [contenteditable="true"], [contenteditable=""]')]).filter(visible);
    const candidates = [];
    const groups = new Set();
    for (const input of inputs) {
      const group = groupFor(input);
      if (group) {
        const key = group.inputs[0];
        if (!groups.has(key)) { groups.add(key); candidates.push(group); }
      } else if (!otpCell(input)) {
        candidates.push({ type: 'single', inputs: [input], score: score(input), anchor: input, context: contextText(input), channel: channel(input) });
      }
    }
    const priority = { email: 4, unknown: 3, authenticator: 1, sms: 0 };
    const usable = candidates.filter(candidate => candidate.score >= 4);
    const modal = usable.filter(candidate => candidate.anchor.closest?.('dialog[open],[role="dialog"],[aria-modal="true"]'));
    candidates.splice(0, candidates.length, ...(modal.length ? modal : usable));
    candidates.sort((a, b) => priority[b.channel] - priority[a.channel] || b.score - a.score);
    if (!candidates.length || candidates[0].score < 4) return null;
    if (candidates[0].score < 5 && candidates.length > 1 && candidates[1].score === candidates[0].score && candidates[1].channel === candidates[0].channel) return null;
    return candidates[0];
  }

  async function insert(candidate, code) {
    if (!candidate || !candidate.inputs.every(visible) || !/^[A-Za-z0-9]{4,8}$/.test(code)) return false;
    if (candidate.type === 'group' && code.length !== candidate.inputs.length) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter && candidate.inputs.some(input => input.tagName === 'INPUT')) return false;
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const matches = () => candidate.inputs.every((input, index) =>
      (input.tagName === 'INPUT' ? input.value : input.textContent) === (candidate.type === 'group' ? code[index] : code));
    if (candidate.type === 'group') {
      // React OTP components can accept the whole code atomically through paste.
      // Let focus state commit before their handler chooses its starting index.
      candidate.inputs[0].focus();
      await settle();
      if (!candidate.inputs.every(visible)) return false;
      let paste;
      try {
        const data = new DataTransfer();
        data.setData('text/plain', code);
        paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: data });
      } catch {
        paste = new Event('paste', { bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(paste, 'clipboardData', { value: { getData: type => /^(?:text|text\/plain)$/i.test(type) ? code : '' } });
      }
      candidate.inputs[0].dispatchEvent(paste);
      await settle();
      if (matches()) return true;
      // A handler that consumed paste must not receive a second insertion attempt.
      if (paste.defaultPrevented) return false;
    }
    for (const [index, input] of candidate.inputs.entries()) {
      if (!candidate.inputs.every(visible)) return false;
      const value = candidate.type === 'group' ? code[index] : code;
      // Some OTP components write through their focused-cell index, not the event target.
      // Focus each cell before notifying controlled state, including when insertion
      // starts with another cell selected or the inline button holding focus.
      input.focus();
      await settle();
      if (!candidate.inputs.every(visible)) return false;
      if (input.isContentEditable || input.getAttribute?.('contenteditable') === 'true' || input.getAttribute?.('contenteditable') === '') {
        input.textContent = value;
        const inputEvent = typeof InputEvent === 'function' ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }) : new Event('input', { bubbles: true });
        input.dispatchEvent(inputEvent);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (setter) {
        setter.call(input, value);
        const inputEvent = typeof InputEvent === 'function' ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }) : new Event('input', { bubbles: true });
        input.dispatchEvent(inputEvent);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await settle();
    }
    return matches();
  }

  return { detect, insert, score, roots };
})();
