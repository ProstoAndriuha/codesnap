// Classic content-script module: kept dependency-free so it can run on every HTTPS page.
globalThis.VerificationFields = (() => {
  const WORDS = /(?:verif(?:ication|y)?|security\s*code|confirm(?:ation)?\s*code|one[\s-]*time(?:\s*(?:code|password|pin))?|auth(?:entication)?\s*code|enter\s*(?:the\s*)?(?:(?:6|4|8)[\s-]*digit\s*)?code|email\s*code|\botp\b|\b2fa\b|\bmfa\b|\btotp\b|two[\s-]*factor|two[\s-]*step|backup\s*code|recovery\s*code|pin\s*code|passcode|access\s*code|withdrawal\s*code|login\s*code|google\s*auth|(?:6|4|8)[\s-]*digit(?:\s*(?:code|pin|verification))?|digit\s*code|(?:digit|character|char|цифр[ауы]|символ)\s*#?\d+\s*(?:of|из|\/)\s*\d+|код\s*(?:подтверждения|верификации|безопасности|восстановления|для\s*(?:входа|вывода|доступа|подтверждения)|вывода|авторизации|доступа)|резервн[а-я]*\s*код|подтверд(?:ите|ение)\s*(?:вывод|вход|действие|операцию)?|одноразов(?:ый|ого)\s*(?:код|пароль)|проверочн(?:ый|ого)\s*код|двухфакторн[а-я]*|двухэтапн[а-я]*|введите\s*код|получить\s*код|запросить\s*код|код\s*(?:из|с|по|на)\s*(?:письма|почты|почту|e[\s-]?mail|эл\.?\s*почт[а-я]*)|(?:6|4|8)[\s-]*значн(?:ый|ого)\s*код|cod\s*(?:de\s*)?(?:verificare|confirmare|securitate|otp)|introduceți\s*cod|código\s*(?:de\s*)?(?:verificación|confirmación|seguridad)|code\s*(?:de\s*)?(?:vérification|confirmation|sécurité)|bestätigungscode|sicherheitscode|验证码)/i;
  const WEAK = /(?:code|код|\bcod\b)/i;

  const EMAIL_DELIVERY = /(?:(?:sent|emailed|delivered|we\s+sent|code\s+sent)\s+(?:a\s+code\s+)?to\b[^.]{0,40}@|check\s+your\s+(?:e[\s-]?mail|inbox)|(?:code|otp)(?:\s+[a-z0-9-]+){0,3}\s+(?:from|via|in|sent\s+to|by|to)\s+(?:your\s+)?(?:e[\s-]?mail|inbox)|код(?:\s+[а-яё-]+){0,3}\s+(?:из|с|по|на)\s+(?:вашу\s+|свою\s+)?(?:эл\.?\s*почт[а-я]*|почт[а-я]+|письм[а-я]+)|e[\s-]?mail\s+(?:verification|confirmation|authentication|security|code|otp)|верификаци[яи]\s+по\s+(?:эл\.?\s*)?почт|подтверждени[ея]\s+по\s+(?:эл\.?\s*)?почт|проверьте\s+(?:вашу\s+|свою\s+)?(?:эл\.?\s*)?(?:почту|входящие)|отправлен[аоы]?\s+на\s+(?:эл\.?\s*почт|[a-z0-9._%*+-]+@)|cod\s*(?:din|primit\s*prin)\s*email|verificare\s+prin\s+email|vérification\s+par\s+courriel|[a-z0-9][a-z0-9._-]{0,12}[*•·]{1,10}[a-z0-9._-]{0,12}@(?:[a-z0-9*•·.-]+\.)+[a-z*]{2,}|gm[\*a-z0-9]*il|yand[\*a-z0-9]*x)/i;
  const EMAIL_TERM = /(?:e[\s-]?mail|эл\.?\s*почт[а-я]*|почт[а-я]+|письм[а-я]+|inbox|входящи[ех]|courriel|correo|posta\s*electronic)/i;
  const BARE_EMAIL = /[a-z0-9._%+-]+@(?:[a-z0-9.-]+\.)+[a-z]{2,}/gi;

  const AUTH_STRONG = /(?:authenticator|authentication\s*app|verification\s*app|code\s*generator|generator\s*app|authy|1password|bitwarden|duo\s*mobile|\bduo\b|okta\s*verify|freeotp|aegis|2fas|raivo|ente\s*auth|microsoft\s*authenticator|google\s*authenticator|google\s*auth\b|\bga\s*code\b|steam\s*guard|\btotp\b|time[\s-]*based\s*one[\s-]*time|аутентификатор[а-я]*|гугл[\s-]*аут[а-я]*|яндекс[\s-]*ключ|yandex[\s-]*key|приложени[яеию]\s*(?:для\s*)?(?:аутентификаци|генераци|кодов)|код\s*из\s*приложения|откройте\s*приложение|open\s+your\s+(?:authenticator\s+)?app|aplicaț(?:ia|iei)\s*de\s*autentificare)/i;
  const AUTH_GENERIC = /(?:\b2fa\b|\bmfa\b|two[\s-]*factor|two[\s-]*step|2[\s-]*step|multi[\s-]*factor|двухфакторн[а-я]*|двухэтапн[а-я]*|аутентификаци[а-я]*\s*2fa)/i;
  const AUTH_QR_SETUP = /(?:scan\s+(?:this\s+|the\s+)?qr|qr[\s-]*code|отсканируйте\s+qr|qr[\s-]*код|setup\s*key|ключ\s*настройки)/i;
  const AUTH_RECOVERY = /(?:backup\s*code|recovery\s*code|emergency\s*code|резервн[а-я]*\s*код|код\s*восстановления|аварийн[а-я]*\s*код)/i;
  const AUTH_HARDWARE = /(?:passkey|security\s*key|hardware\s*key|yubikey|webauthn|ключ\s*безопасности|аппаратн[а-я]*\s*ключ)/i;

  const VERIFICATION = /(?:верификаци[яи]|проверка\s*(?:безопасности|почты)|подтверждение|verification|verify|verificare|verificación|vérification|bestätigung|验证)/i;
  const RESEND = /(?:resend|send\s*(?:again|code)|отправить\s*повторно|повторн[а-я]*\s*(?:отправ|код)|retrimit|reenviar|renvoyer)/i;
  const ALTERNATIVE = /(?:switch\b|instead\b|try\s+another|use\s+(?:another|a\s+different|email|authenticator|sms|phone|backup|recovery)|verify\s+(?:via|with|using)\s+(?:email|authenticator|sms|another)|send\s+(?:a\s+)?(?:verification\s+)?code\s+(?:to|via)\s+email|having\s+trouble|lost\s+(?:your|access)|can'?t\s+access|другой\s*способ|с\s*помощью|переключ|недоступ|unavailable|использовать\s*(?:почту|эл\.\s*почту|приложение|аутентификатор|резервный)|получить\s*код\s*на\s*почту|подтвердить\s*(?:по|через)\s*почт|нет\s*доступа)/i;
  const SMS = /(?:\bsms\b|text\s*message|phone\s*code|mobile\s*number|код\s*из\s*смс|код\s*на\s*(?:телефон|номер)|cod\s*prin\s*sms)/i;
  const EXCLUDED_ATTRS = /(?:^|[^A-Za-zА-Яа-яЁё0-9])(?:cvv2?|cvc2?|cid|csc|cc-csc|card[-_\s]*(?:number|security|code|pin)|credit[-_\s]*card|expir(?:y|ation)|iban|bic|swift|ssn|tin|tax[-_\s]*id|inn|kpp|snils|ogrn|инн|кпп|снилс|огрн|паспорт|passport|captcha|promo(?:code)?|coupon|voucher|discount|referral|invite|postal|zip[-_\s]*code|postcode|индекс|quantity|qty|amount|price|сумма|количество|leverage|slippage)(?=$|[^A-Za-zА-Яа-яЁё0-9])/i;
  const CELL_ARIA = /(?:digit|character|char|цифр[ауы]|символ)\s*#?\d+/i;
  const CODE_MASK_PLACEHOLDER = /^(?:0{4,8}|1234(?:56)?|[•*·_xX-](?:\s*[•*·_xX-]){3,7})$/;
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

  function expandTokens(value) {
    const raw = String(value ?? '');
    if (!raw) return '';
    return `${raw} ${raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')}`;
  }

  function isEditableElement(el) {
    if (!el || el.disabled || el.readOnly || el.isConnected === false) return false;
    if (el.tagName === 'INPUT') return allowedType.test(el.type || 'text');
    return el.isContentEditable || el.getAttribute?.('contenteditable') === 'true' || el.getAttribute?.('contenteditable') === '';
  }

  function otpCell(input) {
    if (!visible(input)) return false;
    if (input.maxLength === 1) return true;
    if (CELL_ARIA.test(input.getAttribute?.('aria-label') ?? '')) return true;
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
    const attrs = attributeText(input);
    const parent = input.parentElement;
    const otpContainer = Boolean(
      input.hasAttribute?.('data-input-otp') ||
      input.closest?.('[data-input-otp],[data-otp-input],.ant-otp,.chakra-pin-input,.MuiOtpInput-Box') ||
      /(?:otp|code|verification|slot)/i.test(`${parent?.className ?? ''} ${parent?.getAttribute?.('data-slot') ?? ''}`)
    );
    return input.tabIndex >= 0 && (/one-time-code/i.test(input.autocomplete ?? '') || (WORDS.test(attrs) && otpContainer));
  }

  function attributeText(input) {
    const rawParts = [
      input.name,
      input.id,
      input.placeholder,
      input.autocomplete,
      input.inputMode,
      input.pattern,
      input.getAttribute?.('aria-label'),
      input.getAttribute?.('data-testid'),
      input.getAttribute?.('data-qa'),
      input.getAttribute?.('data-cy'),
      input.getAttribute?.('data-slot')
    ].filter(Boolean);
    return rawParts.map(expandTokens).join(' ');
  }

  function cleanNodeText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType !== 1) return '';
    if (node.matches?.('a, button, [role="button"]') && ALTERNATIVE.test(node.textContent ?? '')) return '';
    let out = '';
    for (const child of node.childNodes ?? []) out += ` ${cleanNodeText(child)}`;
    return out.replace(/\s+/g, ' ').trim();
  }

  function explicitLayerText(input) {
    const parts = [];
    if (input.labels) for (const l of input.labels) parts.push(expandTokens(cleanNodeText(l)));
    const labelledBy = `${input.getAttribute?.('aria-labelledby') ?? ''} ${input.getAttribute?.('aria-describedby') ?? ''}`.trim();
    if (labelledBy && input.ownerDocument) {
      for (const id of labelledBy.split(/\s+/)) {
        const el = input.ownerDocument.getElementById(id);
        if (el) parts.push(expandTokens(cleanNodeText(el)));
      }
    }
    return `${attributeText(input)} ${parts.filter(Boolean).join(' ')}`.trim();
  }

  function contextParts(input) {
    const parts = [];
    if (input.labels) for (const l of input.labels) parts.push(cleanNodeText(l));
    const labelledBy = `${input.getAttribute?.('aria-labelledby') ?? ''} ${input.getAttribute?.('aria-describedby') ?? ''}`.trim();
    if (labelledBy && input.ownerDocument) {
      for (const id of labelledBy.split(/\s+/)) {
        const el = input.ownerDocument.getElementById(id);
        if (el) parts.push(cleanNodeText(el));
      }
    }
    let current = input;
    for (let depth = 0; current && depth < 8; depth++) {
      const parent = current.parentElement || current.parentNode;
      if (!parent || parent.nodeType === 9 /* document */) break;
      let prev = current.previousElementSibling;
      while (prev) {
        if (prev.matches?.('input,[contenteditable]') || prev.querySelector?.('input,[contenteditable]')) break;
        const text = cleanNodeText(prev);
        if (text) parts.push(text);
        prev = prev.previousElementSibling;
      }
      const inputsInParent = parent.querySelectorAll ? parent.querySelectorAll('input') : [];
      if (inputsInParent.length <= 1) {
        const labels = parent.querySelectorAll ? parent.querySelectorAll('label, [class*="label" i], [class*="title" i], legend') : [];
        for (const el of labels) {
          if (!el.querySelector('input') && !el.contains(input)) {
            const text = cleanNodeText(el);
            if (text) parts.push(text);
          }
        }
      }
      const others = [...inputsInParent].filter(el => el !== input);
      const possibleCells = inputsInParent.length >= 4 && inputsInParent.length <= 8 && [...inputsInParent].every(el => el.maxLength === 1 || (el.maxLength < 0 && (el.value ?? '').length <= 1));
      if (others.some(el => !otpCell(el)) && !possibleCells) break;
      const joinedSoFar = parts.join(' ');
      if (AUTH_STRONG.test(joinedSoFar) || AUTH_RECOVERY.test(joinedSoFar) || AUTH_HARDWARE.test(joinedSoFar) || EMAIL_DELIVERY.test(joinedSoFar) || SMS.test(joinedSoFar)) break;
      if (parent.matches?.('form,dialog,[role="dialog"],fieldset')) break;
      current = parent.host || parent;
    }
    const directParent = input.parentElement || input.parentNode;
    if (directParent && directParent.nodeType !== 9) {
      const text = [...directParent.childNodes].map(el => cleanNodeText(el)).filter(Boolean).join(' ');
      if (text) parts.push(text);
    }
    return parts.filter(Boolean).map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function contextText(input) {
    return contextParts(input).join(' ').slice(0, 600);
  }

  function outerSingleTargetContext(input, groupInputs = null) {
    const scope = input.closest?.('form, fieldset');
    if (!scope) return '';
    const allowedSet = new Set(groupInputs ?? [input]);
    const editableInScope = [...scope.querySelectorAll('input, [contenteditable="true"], [contenteditable=""]')].filter(visible);
    if (editableInScope.some(el => !allowedSet.has(el))) return '';

    const parts = [];
    let current = scope;
    for (let depth = 0; current && depth < 3; depth++) {
      const parent = current.parentElement;
      if (!parent || parent.nodeType === 9) break;
      let prev = current.previousElementSibling;
      let count = 0;
      while (prev && count < 4) {
        if (prev.matches?.('input,[contenteditable]') || prev.querySelector?.('input,[contenteditable]')) break;
        const text = cleanNodeText(prev);
        if (text) parts.push(text);
        prev = prev.previousElementSibling;
        count++;
      }
      if (parent.matches?.('dialog,[role="dialog"],[aria-modal="true"],main,body')) break;
      const inputsInParent = [...parent.querySelectorAll('input, [contenteditable="true"], [contenteditable=""]')].filter(visible);
      if (inputsInParent.some(el => !allowedSet.has(el))) break;
      current = parent;
    }
    return parts.filter(Boolean).join(' ').slice(0, 500);
  }

  function detectProviderHint(text) {
    if (/google\s*authenticator|google\s*auth\b|\bga[\s_-]*code\b|гугл[\s-]*аут/i.test(text)) return 'google-authenticator';
    if (/microsoft\s*authenticator/i.test(text)) return 'microsoft-authenticator';
    if (/yandex[\s-]*key|яндекс[\s-]*ключ/i.test(text)) return 'yandex-key';
    if (/\bauthy\b/i.test(text)) return 'authy';
    if (/1password/i.test(text)) return '1password';
    if (/bitwarden/i.test(text)) return 'bitwarden';
    if (/duo\s*mobile|\bduo\b/i.test(text)) return 'duo';
    if (/okta\s*verify/i.test(text)) return 'okta';
    if (/\b2fas\b/i.test(text)) return '2fas';
    if (/\baegis\b/i.test(text)) return 'aegis';
    if (/steam\s*guard/i.test(text)) return 'steam-guard';
    if (/yubikey|passkey|webauthn/i.test(text)) return 'security-key';
    return null;
  }

  function scoreLayer(text, weight, totals) {
    if (!text) return;
    const hasAuthStrong = AUTH_STRONG.test(text) || AUTH_QR_SETUP.test(text);
    const hasAuthRec = AUTH_RECOVERY.test(text);
    const hasAuthHw = AUTH_HARDWARE.test(text);
    const hasAuthGen = AUTH_GENERIC.test(text);
    if (hasAuthStrong || hasAuthRec || hasAuthHw) totals.auth += 8 * weight;
    else if (hasAuthGen) totals.auth += 4 * weight;

    if (SMS.test(text)) totals.sms += 8 * weight;

    const textWithoutBareEmails = text.replace(BARE_EMAIL, ' ');
    if (EMAIL_DELIVERY.test(text)) totals.email += 8 * weight;
    else if (EMAIL_TERM.test(textWithoutBareEmails)) totals.email += 3 * weight;
    else if (BARE_EMAIL.test(text)) totals.bareEmail = true;
  }

  function classifyChannel(input, groupContext = '', groupInputs = null) {
    const layer0 = explicitLayerText(input);
    const layer1Parts = [...contextParts(input), groupContext].filter(Boolean);
    const layer1 = layer1Parts.join(' ');
    const layer2 = outerSingleTargetContext(input, groupInputs);
    const allText = `${layer0} ${layer1} ${layer2}`;

    const providerHint = detectProviderHint(allText);
    const subchannelFrom = text =>
      AUTH_RECOVERY.test(text) ? 'recovery' :
      AUTH_HARDWARE.test(text) ? 'hardware' : 'totp';

    const layer0Auth = AUTH_STRONG.test(layer0) || AUTH_RECOVERY.test(layer0) || AUTH_HARDWARE.test(layer0);
    if (layer0Auth && !EMAIL_DELIVERY.test(layer0)) {
      return { channel: 'authenticator', subchannel: subchannelFrom(allText), providerHint, confidence: 'high' };
    }
    if (SMS.test(layer0) && !EMAIL_DELIVERY.test(layer0)) {
      return { channel: 'sms', subchannel: 'sms_otp', providerHint: null, confidence: 'high' };
    }
    if (EMAIL_DELIVERY.test(layer0) || (EMAIL_TERM.test(layer0.replace(BARE_EMAIL, ' ')) && !AUTH_GENERIC.test(layer0))) {
      return { channel: 'email', subchannel: 'email_otp', providerHint: null, confidence: 'high' };
    }

    const totals = { auth: 0, email: 0, sms: 0, bareEmail: false };
    scoreLayer(layer0, 3, totals);
    scoreLayer(layer1, 2, totals);
    scoreLayer(layer2, 1, totals);

    const immediateBoxText = input.parentElement?.parentElement?.textContent ?? '';
    if (RESEND.test(immediateBoxText) && !SMS.test(immediateBoxText) && !AUTH_STRONG.test(layer1)) {
      totals.email += 3;
    }
    if (totals.bareEmail && totals.auth === 0 && totals.sms === 0) {
      totals.email += 1.5;
    }

    if (totals.auth === 0 && totals.email === 0 && totals.sms === 0) {
      const loc = input.ownerDocument?.location;
      const urlText = `${loc?.pathname ?? ''}${loc?.search ?? ''}`;
      const titleText = input.ownerDocument?.title ?? '';
      if (/(?:^|[\/_-])(?:totp|2fa|mfa|two[-_]?factor|authenticator)(?:$|[\/_?-])/i.test(urlText) || AUTH_STRONG.test(titleText)) {
        totals.auth += 4;
      }
    }

    if (totals.auth > totals.email && totals.auth >= totals.sms && totals.auth >= 3) {
      const margin = totals.auth - Math.max(totals.email, totals.sms);
      return { channel: 'authenticator', subchannel: subchannelFrom(allText), providerHint, confidence: margin >= 6 ? 'high' : 'medium' };
    }
    if (totals.sms > totals.email && totals.sms > totals.auth && totals.sms >= 3) {
      const margin = totals.sms - Math.max(totals.email, totals.auth);
      return { channel: 'sms', subchannel: 'sms_otp', providerHint: null, confidence: margin >= 6 ? 'high' : 'medium' };
    }
    if (totals.email >= 3 && totals.email >= totals.auth) {
      const margin = totals.email - Math.max(totals.auth, totals.sms);
      return { channel: 'email', subchannel: 'email_otp', providerHint: null, confidence: margin >= 6 ? 'high' : 'medium' };
    }
    return { channel: 'unknown', subchannel: 'generic', providerHint: null, confidence: 'low' };
  }

  function score(input) {
    if (!visible(input)) return -1;
    const attrs = attributeText(input);
    if (EXCLUDED_ATTRS.test(attrs)) return -1;
    // Login forms mention a future OTP beside the email-address field.
    const identifier = expandTokens(`${input.name ?? ''} ${input.id ?? ''} ${input.getAttribute?.('aria-label') ?? ''}`);
    const maskMatch = CODE_MASK_PLACEHOLDER.test(String(input.placeholder ?? '').trim());
    const codeShape = /^(?:numeric|decimal)$/i.test(input.inputMode ?? '') || (input.maxLength >= 4 && input.maxLength <= 8) || maskMatch;
    if (!codeShape && !WORDS.test(attrs) && !WEAK.test(attrs) && (/(?:email|username|current-password|new-password)/i.test(input.autocomplete ?? '') ||
      /(?:^|[-_\s])(?:e-?mail|email-address|username|password)(?:$|[-_\s])/i.test(identifier) ||
      /(?:enter|введите|your|ваш).*?(?:e[\s-]?mail|почт|password|пароль)/i.test(input.placeholder ?? ''))) return -1;
    const context = `${contextText(input)} ${outerSingleTargetContext(input)}`.trim();
    const verificationContext = WORDS.test(context) || ((VERIFICATION.test(context) || WEAK.test(context)) && (EMAIL_DELIVERY.test(context) || EMAIL_TERM.test(context.replace(BARE_EMAIL, ' ')) || AUTH_STRONG.test(context) || AUTH_GENERIC.test(context) || SMS.test(context)));
    const deliveryContext = (EMAIL_DELIVERY.test(context) || EMAIL_TERM.test(context)) && RESEND.test(input.parentElement?.parentElement?.textContent ?? '');
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
    if (maskMatch) value += 2;
    if (input.type === 'password') value -= 2;
    try { if (input === input.ownerDocument?.activeElement) value += 3; } catch {}
    return value;
  }

  function expectedCodeLength(input) {
    const max = input.maxLength;
    return max >= 4 && max <= 8 ? max : null;
  }

  function groupFor(input) {
    if (!visible(input)) return null;
    let ancestor = input.parentElement;
    for (let depth = 0; ancestor && depth < 6; depth++, ancestor = ancestor.parentElement) {
      const inputs = [...ancestor.querySelectorAll('input, [contenteditable="true"], [contenteditable=""]')].filter(candidate => visible(candidate));
      if (inputs.length < 4 || inputs.length > 8 || !inputs.includes(input)) continue;
      const cellLike = inputs.every(candidate => candidate.maxLength === 1 || (candidate.maxLength < 0 && (candidate.value ?? candidate.textContent).length <= 1) || CELL_ARIA.test(candidate.getAttribute?.('aria-label') ?? '') || ((candidate.isContentEditable || candidate.getAttribute?.('contenteditable') === 'true') && candidate.textContent.length <= 1));
      if (!cellLike) continue;
      const cleanPrev = el => {
        const prev = el?.previousElementSibling;
        if (!prev || prev.matches?.('input,[contenteditable]') || prev.querySelector?.('input,[contenteditable]')) return '';
        return cleanNodeText(prev);
      };
      const ownText = cleanNodeText(ancestor);
      const ancestorLabel = ancestor.getAttribute?.('aria-label') ?? '';
      const selfContext = [ownText, contextText(inputs[0]), ancestorLabel].filter(Boolean).join(' ').slice(0, 500);
      const selfStrong = WORDS.test(selfContext) || EMAIL_DELIVERY.test(selfContext) || AUTH_STRONG.test(selfContext) || AUTH_GENERIC.test(selfContext) ||
        inputs.some(candidate => WORDS.test(attributeText(candidate)) || CELL_ARIA.test(attributeText(candidate)) || candidate.autocomplete === 'one-time-code');
      const context = selfStrong ? selfContext : [
        selfContext,
        cleanPrev(ancestor),
        cleanPrev(ancestor.parentElement),
        cleanPrev(ancestor.parentElement?.parentElement)
      ].filter(Boolean).join(' ').slice(0, 500);
      const strongContext = selfStrong || WORDS.test(context) || EMAIL_DELIVERY.test(context) || AUTH_STRONG.test(context) || AUTH_GENERIC.test(context);
      if (!strongContext) continue;
      const scoreValue = Math.max(...inputs.map(score)) + 6;
      if (scoreValue >= 6) {
        const cls = classifyChannel(inputs[0], context, inputs);
        return { type: 'group', inputs, score: scoreValue, anchor: inputs.at(-1), context, ...cls, expectedLength: inputs.length };
      }
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

  function collectAllFields(root = document, options = {}) {
    const inputs = roots(root).flatMap(part => [...part.querySelectorAll('input, [contenteditable="true"], [contenteditable=""]')]).filter(visible);
    const candidates = [];
    const groups = new Set();
    for (const input of inputs) {
      const group = groupFor(input);
      if (group) {
        const key = group.inputs[0];
        if (!groups.has(key)) { groups.add(key); candidates.push(group); }
      } else if (!otpCell(input)) {
        const cls = classifyChannel(input);
        candidates.push({ type: 'single', inputs: [input], score: score(input), anchor: input, context: `${contextText(input)} ${outerSingleTargetContext(input)}`.trim().slice(0, 600), ...cls, expectedLength: expectedCodeLength(input) });
      }
    }
    const priority = options.preferChannel === 'authenticator'
      ? { authenticator: 5, email: 3, unknown: 2, sms: 0 }
      : options.allow2fa
        ? { email: 5, authenticator: 4, unknown: 3, sms: 0 }
        : { email: 4, unknown: 3, authenticator: 1, sms: 0 };
    const usable = candidates.filter(candidate => candidate.score >= 4);
    const modal = usable.filter(candidate => candidate.anchor.closest?.('dialog[open],[role="dialog"],[aria-modal="true"]'));
    const list = modal.length ? modal : usable;
    list.sort((a, b) => priority[b.channel] - priority[a.channel] || b.score - a.score);
    return list;
  }

  function detectAll(root = document, options = {}) {
    visibilityCache = new WeakMap();
    try { return collectAllFields(root, options); } finally { visibilityCache = null; }
  }

  function detect(root = document, options = {}) {
    const candidates = detectAll(root, options);
    if (!candidates.length || candidates[0].score < 4) return null;
    if (candidates[0].score < 5 && candidates.length > 1 && candidates[1].score === candidates[0].score && candidates[1].channel === candidates[0].channel) return null;
    return candidates[0];
  }

  function detect2FA(root = document) {
    return detectAll(root, { preferChannel: 'authenticator' }).find(candidate => candidate.channel === 'authenticator') ?? null;
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
      if (paste.defaultPrevented) return false;
    }
    for (const [index, input] of candidate.inputs.entries()) {
      if (!candidate.inputs.every(visible)) return false;
      const value = candidate.type === 'group' ? code[index] : code;
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

  const LINK_PROMPT = /(?:check\s+your\s+(?:e-?mail|inbox)|we(?:'ve|\s+have)?\s+sent\s+(?:you\s+)?(?:a|an)\s+(?:confirmation|verification|activation|magic|login|sign-?in)\s+link|(?:confirmation|verification|activation|magic|sign-?in)\s+link\s+(?:has\s+been\s+|was\s+)?sent|click\s+the\s+link\s+(?:we\s+sent|in\s+(?:your|the)\s+email)|verify\s+your\s+e-?mail\s+address|confirm\s+your\s+e-?mail|проверьте\s+(?:свою\s+)?(?:почту|эл\.?\s*почту|ящик)|мы\s+отправили\s+(?:вам\s+)?ссылку|ссылка\s+(?:для\s+)?(?:подтверждения|активации|входа)\s+отправлена|перейдите\s+по\s+ссылке\s+из\s+письма|подтвердите\s+(?:ваш\s+)?(?:e-?mail|адрес\s+почты)|vérifiez\s+votre\s+boîte|lien\s+de\s+(?:confirmation|vérification)|bestätigungslink\s+gesendet)/i;

  function elementShown(el) {
    for (let node = el; node; node = node.parentElement || node.getRootNode?.().host) {
      if (node.hidden || node.hasAttribute?.('inert') || node.getAttribute?.('aria-hidden') === 'true') return false;
      const style = el.ownerDocument?.defaultView?.getComputedStyle(node);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    }
    return true;
  }

  function detectLinkPrompt(root = document) {
    const loc = root?.location ?? globalThis.location;
    if (loc && globalThis.CodeSnapWebmail?.detectProvider?.(loc.hostname, loc.pathname)) return null;
    const modalContainers = [...(root.querySelectorAll?.('dialog[open], [role="dialog"], [aria-modal="true"]') ?? [])].filter(elementShown);
    const containers = modalContainers.length
      ? modalContainers
      : [...(root.querySelectorAll?.('main, form, section, article, [class*="verify" i], [class*="confirm" i], [class*="magic" i], [class*="check-email" i], [class*="pending" i]') ?? [])].filter(elementShown);
    if (!containers.length && root.body && elementShown(root.body)) containers.push(root.body);

    for (const container of containers) {
      const text = (container.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 15 || text.length > 1500) continue;
      const hasCredentialInput = [...(container.querySelectorAll?.('input[type="email"], input[type="password"], input[name*="email" i], input[autocomplete="email"]') ?? [])].some(el => !el.disabled && elementShown(el));
      if (hasCredentialInput) continue;
      if (!LINK_PROMPT.test(text)) continue;
      const anchor = [...(container.querySelectorAll?.('h1, h2, h3, [role="heading"], button, p') ?? [])].find(elementShown) || container;
      return { type: 'link-prompt', inputs: [], score: 6, anchor, context: text.slice(0, 500), channel: 'email', subchannel: 'email_link', providerHint: null, confidence: 'high', expectedLength: null };
    }
    return null;
  }

  return { detect, detect2FA, detectAll, detectLinkPrompt, classifyChannel, insert, score, roots };
})();
