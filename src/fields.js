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

  function elementTextLen(el) {
    if (!el) return 0;
    return el.tagName === 'INPUT' ? (el.value ?? '').length : (el.textContent ?? '').trim().length;
  }

  function isGroupCellCandidate(candidate, groupLen = 6) {
    if (!visible(candidate)) return false;
    const attrs = attributeText(candidate);
    if (EXCLUDED_ATTRS.test(attrs)) return false;
    if (candidate.tagName === 'INPUT') {
      if (candidate.type === 'email' || /(?:email|username|current-password|new-password)/i.test(candidate.autocomplete ?? '')) return false;
      if ((candidate.value ?? '').length > 1) return false;
      if (candidate.maxLength === 1 || candidate.maxLength < 0 || candidate.maxLength === 2) return true;
      if (groupLen >= 4 && candidate.maxLength === groupLen) return true;
      if (CELL_ARIA.test(candidate.getAttribute?.('aria-label') ?? '')) return true;
      return false;
    }
    const ce = candidate.isContentEditable || candidate.getAttribute?.('contenteditable') === 'true' || candidate.getAttribute?.('contenteditable') === '';
    return Boolean(ce && (candidate.textContent ?? '').trim().length <= 1);
  }

  function findDecorativeSlotsContainer(input) {
    if (!input || input.tagName !== 'INPUT') return null;
    const checkBoxGroup = (container, elList) => {
      if (elList.length < 4 || elList.length > 8) return null;
      if (!elList.every(el => /^(?:DIV|SPAN|LI|I|P)$/.test(el.tagName) &&
        !el.querySelector?.('input,[contenteditable],button,a,select,textarea') &&
        (el.textContent ?? '').trim().length <= 1)) return null;
      const sameTag = elList.every(el => el.tagName === elList[0].tagName);
      const otpCue = Boolean(
        /one-time-code/i.test(input.autocomplete ?? '') ||
        /^(?:numeric|decimal)$/i.test(input.inputMode ?? '') ||
        input.type === 'tel' ||
        (input.maxLength >= 4 && input.maxLength <= 8) ||
        WORDS.test(attributeText(input)) ||
        /(?:otp|code|pin|digit|cell|slot|box|verif|auth|totp)/i.test(`${container.className ?? ''} ${input.className ?? ''}`)
      );
      if (!sameTag && !otpCue) return null;
      if (elList.every(el => elementShown(el))) return { container, slots: elList };
      return null;
    };

    for (const parent of [input.parentElement, input.parentElement?.parentElement]) {
      if (!parent || parent.nodeType !== 1) continue;
      const directBoxes = [...parent.children].filter(el => el !== input && !el.contains(input) && !el.querySelector?.('input,[contenteditable]'));
      const directHit = checkBoxGroup(parent, directBoxes);
      if (directHit) return directHit;
      for (const child of parent.children) {
        if (child === input || child.contains(input) || child.querySelector?.('input,[contenteditable]')) continue;
        const sibHit = checkBoxGroup(child, [...child.children]);
        if (sibHit) return sibHit;
      }
    }
    return null;
  }

  function resolveAnchor(input, slotsInfo = null) {
    if (typeof input?.getBoundingClientRect !== 'function') return input;
    const rect = input.getBoundingClientRect();
    if (rect.width >= 24 && rect.height >= 16 && rect.right > 0) return input;
    const info = slotsInfo ?? findDecorativeSlotsContainer(input);
    if (info?.container && typeof info.container.getBoundingClientRect === 'function') {
      const cr = info.container.getBoundingClientRect();
      if (cr.width >= 60 && cr.height >= 20 && cr.width <= 640 && cr.right > 0) return info.container;
    }
    let parent = input.parentElement;
    for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
      const cr = parent.getBoundingClientRect?.();
      if (cr && cr.width >= 60 && cr.height >= 20 && cr.width <= 640 && cr.right > 0) return parent;
    }
    return input;
  }

  function otpCell(input) {
    if (!visible(input)) return false;
    if (input.maxLength === 1) return true;
    if (CELL_ARIA.test(input.getAttribute?.('aria-label') ?? '')) return true;
    if ((input.isContentEditable || input.getAttribute?.('contenteditable') === 'true' || input.getAttribute?.('contenteditable') === '') && elementTextLen(input) <= 1) {
      if (/(?:otp|cell|digit|slot|box)/i.test(`${input.className || ''} ${input.getAttribute?.('data-cell') || ''}`)) return true;
      const sibCount = [...(input.parentElement?.children ?? [])].filter(visible).length;
      if (sibCount >= 4 && sibCount <= 8) return true;
    }
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
    // input-otp & custom exchange overlays keep the real, focusable input over decorative slots.
    const attrs = attributeText(input);
    const parent = input.parentElement;
    const otpContainer = Boolean(
      input.hasAttribute?.('data-input-otp') ||
      input.closest?.('[data-input-otp],[data-otp-input],.ant-otp,.chakra-pin-input,.MuiOtpInput-Box,[class*="otp" i],[class*="pin" i],[class*="code" i],[class*="verif" i]') ||
      /(?:otp|code|verification|slot|pin|digit|box)/i.test(`${parent?.className ?? ''} ${parent?.getAttribute?.('data-slot') ?? ''}`)
    );
    return input.tabIndex >= 0 && (
      /one-time-code/i.test(input.autocomplete ?? '') ||
      (WORDS.test(attrs) && otpContainer) ||
      Boolean(findDecorativeSlotsContainer(input)) ||
      (otpContainer && ((input.maxLength >= 4 && input.maxLength <= 8) || /^(?:numeric|decimal)$/i.test(input.inputMode ?? '') || input.type === 'tel'))
    );
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

  function hasVisibleEditable(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches?.('input,[contenteditable="true"],[contenteditable=""]') && visible(node)) return true;
    return [...(node.querySelectorAll?.('input,[contenteditable="true"],[contenteditable=""]') ?? [])].some(visible);
  }

  function contextParts(input, allowedGroup = null) {
    const parts = [];
    if (input.labels) for (const l of input.labels) parts.push(cleanNodeText(l));
    const labelledBy = `${input.getAttribute?.('aria-labelledby') ?? ''} ${input.getAttribute?.('aria-describedby') ?? ''}`.trim();
    if (labelledBy && input.ownerDocument) {
      for (const id of labelledBy.split(/\s+/)) {
        const el = input.ownerDocument.getElementById(id);
        if (el) parts.push(cleanNodeText(el));
      }
    }
    const allowedSet = new Set(allowedGroup ?? [input]);
    let current = input;
    for (let depth = 0; current && depth < 11; depth++) {
      const parent = current.parentElement || current.parentNode;
      if (!parent || parent.nodeType === 9 /* document */ || parent.tagName === 'HTML') break;
      let prev = current.previousElementSibling;
      while (prev) {
        if (hasVisibleEditable(prev)) break;
        const text = cleanNodeText(prev);
        if (text) parts.push(text);
        prev = prev.previousElementSibling;
      }
      const inputsInParent = [...(parent.querySelectorAll ? parent.querySelectorAll('input, [contenteditable="true"], [contenteditable=""]') : [])].filter(visible);
      if (inputsInParent.length <= 1) {
        const labels = parent.querySelectorAll ? parent.querySelectorAll('label, [class*="label" i], [class*="title" i], legend') : [];
        for (const el of labels) {
          if (!el.querySelector('input') && !el.contains(input)) {
            const text = cleanNodeText(el);
            if (text) parts.push(text);
          }
        }
      }
      const others = inputsInParent.filter(el => !allowedSet.has(el));
      const possibleCells = inputsInParent.length >= 4 && inputsInParent.length <= 8 && inputsInParent.every(el => isGroupCellCandidate(el, inputsInParent.length));
      if (others.some(el => !otpCell(el)) && !possibleCells) break;
      const joinedSoFar = parts.join(' ');
      if (AUTH_STRONG.test(joinedSoFar) || AUTH_RECOVERY.test(joinedSoFar) || AUTH_HARDWARE.test(joinedSoFar) || EMAIL_DELIVERY.test(joinedSoFar) || SMS.test(joinedSoFar)) break;
      if (parent.matches?.('dialog,[role="dialog"],[aria-modal="true"]')) break;
      if (parent.matches?.('form,fieldset') && others.length > 0 && !possibleCells) break;
      current = parent.host || parent;
    }
    const directParent = input.parentElement || input.parentNode;
    if (directParent && directParent.nodeType !== 9) {
      const text = [...directParent.childNodes].map(el => cleanNodeText(el)).filter(Boolean).join(' ');
      if (text) parts.push(text);
    }
    return parts.filter(Boolean).map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function contextText(input, allowedGroup = null) {
    return contextParts(input, allowedGroup).join(' ').slice(0, 600);
  }

  function outerSingleTargetContext(input, groupInputs = null) {
    const scope = input.closest?.('form, fieldset');
    if (!scope) return '';
    const allowedSet = new Set(groupInputs ?? [input]);
    const editableInScope = [...scope.querySelectorAll('input, [contenteditable="true"], [contenteditable=""]')].filter(visible);
    if (editableInScope.some(el => !allowedSet.has(el))) return '';

    const parts = [];
    let current = scope;
    for (let depth = 0; current && depth < 6; depth++) {
      const parent = current.parentElement;
      if (!parent || parent.nodeType === 9 || parent.tagName === 'HTML') break;
      let prev = current.previousElementSibling;
      let count = 0;
      while (prev && count < 4) {
        if (hasVisibleEditable(prev)) break;
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
    if (findDecorativeSlotsContainer(input)) value += 3;
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
    for (let depth = 0; ancestor && depth < 12; depth++, ancestor = ancestor.parentElement) {
      if (ancestor.tagName === 'BODY' || ancestor.tagName === 'HTML') break;
      const inputs = [...ancestor.querySelectorAll('input, [contenteditable="true"], [contenteditable=""]')].filter(candidate => visible(candidate));
      if (inputs.length < 4 || inputs.length > 8 || !inputs.includes(input)) continue;
      const cellLike = inputs.every(candidate => isGroupCellCandidate(candidate, inputs.length));
      if (!cellLike) continue;
      const strictlySingleChar = inputs.every(c => c.maxLength === 1 || CELL_ARIA.test(c.getAttribute?.('aria-label') ?? ''));
      if (!strictlySingleChar) {
        if (!inputs.every(c => c.tagName === inputs[0].tagName && (c.type ?? '') === (inputs[0].type ?? '') && c.maxLength === inputs[0].maxLength)) continue;
        if (typeof inputs[0].getBoundingClientRect === 'function') {
          const w0 = inputs[0].getBoundingClientRect().width;
          if (w0 > 0 && inputs.some(c => { const w = c.getBoundingClientRect().width; return w <= 0 || w > 240; })) continue;
        }
      }
      const cleanPrev = el => {
        const prev = el?.previousElementSibling;
        if (!prev || hasVisibleEditable(prev)) return '';
        return cleanNodeText(prev);
      };
      const ownText = cleanNodeText(ancestor);
      const ancestorLabel = ancestor.getAttribute?.('aria-label') ?? '';
      const selfContext = [ownText, contextText(inputs[0], inputs), outerSingleTargetContext(inputs[0], inputs), ancestorLabel].filter(Boolean).join(' ').slice(0, 600);
      const selfStrong = WORDS.test(selfContext) || EMAIL_DELIVERY.test(selfContext) || AUTH_STRONG.test(selfContext) || AUTH_GENERIC.test(selfContext) ||
        inputs.some(candidate => WORDS.test(attributeText(candidate)) || CELL_ARIA.test(attributeText(candidate)) || candidate.autocomplete === 'one-time-code');
      let context = selfContext;
      if (!selfStrong) {
        const extra = [selfContext];
        let holder = ancestor;
        for (let up = 0; up < 5 && holder; up++, holder = holder.parentElement) {
          const txt = cleanPrev(holder);
          if (txt) extra.push(txt);
        }
        context = extra.filter(Boolean).join(' ').slice(0, 600);
      }
      const strongContext = selfStrong || WORDS.test(context) || EMAIL_DELIVERY.test(context) || AUTH_STRONG.test(context) || AUTH_GENERIC.test(context);
      if (!strongContext) continue;
      const rawMax = Math.max(...inputs.map(score));
      const numericBonus = inputs.some(c => /^(?:numeric|decimal)$/i.test(c.inputMode ?? '') || c.type === 'tel' || /one-time-code/i.test(c.autocomplete ?? '')) ? 1 : 0;
      const scoreValue = Math.max(0, rawMax) + 6 + numericBonus;
      const cls = classifyChannel(inputs[0], context, inputs);
      return { type: 'group', inputs, score: scoreValue, anchor: inputs.at(-1), context, ...cls, expectedLength: inputs.length };
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

  function collectCustomOtpField(root = document) {
    const isEmptySlotEl = el =>
      /^(?:DIV|SPAN|LI|I|P)$/.test(el.tagName) &&
      !el.querySelector?.('input,[contenteditable],button,a,select,textarea') &&
      (el.textContent ?? '').trim().length <= 1 &&
      elementShown(el);

    for (const part of roots(root)) {
      const containers = [...(part.querySelectorAll?.('dialog[open],[role="dialog"],[aria-modal="true"],main,form,section,[class*="verify" i],[class*="auth" i],[class*="otp" i]') ?? [])].filter(elementShown);
      for (const container of containers) {
        const containerText = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (containerText.length < 8 || containerText.length > 1500) continue;
        if (!AUTH_STRONG.test(containerText) && !(WORDS.test(containerText) && /(?:enter|введите|code|код)/i.test(containerText))) continue;
        if ([...(container.querySelectorAll?.('input,[contenteditable="true"],[contenteditable=""]') ?? [])].some(visible)) continue;

        for (const holder of container.querySelectorAll('div,ul,ol')) {
          const directTabs = [...holder.children].filter(el => el.hasAttribute?.('tabindex') && isEmptySlotEl(el));
          if (directTabs.length >= 4 && directTabs.length <= 8 && directTabs.length === holder.children.length) {
            const ctx = containerText.slice(0, 500);
            return { type: 'custom-otp', inputs: [directTabs[0]], slots: directTabs, score: 6, anchor: directTabs.at(-1), context: ctx, ...classifyChannel(directTabs[0], ctx), expectedLength: directTabs.length };
          }
        }
        for (const focusEl of container.querySelectorAll('[tabindex]')) {
          if (!elementShown(focusEl) || focusEl.matches?.('a,button,select,textarea')) continue;
          const holders = [focusEl, ...focusEl.querySelectorAll('div,ul,ol')];
          for (const h of holders) {
            const boxEls = [...h.children].filter(isEmptySlotEl);
            if (boxEls.length >= 4 && boxEls.length <= 8 && boxEls.length === h.children.length) {
              const ctx = containerText.slice(0, 500);
              return { type: 'custom-otp', inputs: [focusEl], slots: boxEls, score: 6, anchor: boxEls.at(-1), context: ctx, ...classifyChannel(focusEl, ctx), expectedLength: boxEls.length };
            }
          }
        }
      }
    }
    return null;
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
        const slotsInfo = findDecorativeSlotsContainer(input);
        const anchor = resolveAnchor(input, slotsInfo);
        candidates.push({
          type: 'single',
          inputs: [input],
          slots: slotsInfo?.slots ?? null,
          score: score(input),
          anchor,
          context: `${contextText(input)} ${outerSingleTargetContext(input)}`.trim().slice(0, 600),
          ...cls,
          expectedLength: expectedCodeLength(input) ?? slotsInfo?.slots?.length ?? null
        });
      }
    }
    const priority = options.preferChannel === 'authenticator'
      ? { authenticator: 5, email: 3, unknown: 2, sms: 0 }
      : options.allow2fa
        ? { email: 5, authenticator: 4, unknown: 3, sms: 0 }
        : { email: 4, unknown: 3, authenticator: 1, sms: 0 };
    let usable = candidates.filter(candidate => candidate.score >= 4);
    if (!usable.length) {
      const customField = collectCustomOtpField(root);
      if (customField) usable = [customField];
    }
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

  function dispatchPasteEvent(target, code) {
    let paste;
    try {
      const data = new DataTransfer();
      data.setData('text/plain', code);
      paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: data });
    } catch {
      paste = new Event('paste', { bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(paste, 'clipboardData', { value: { getData: type => /^(?:text|text\/plain)$/i.test(type) ? code : '' } });
    }
    target.dispatchEvent(paste);
    return paste;
  }

  async function insert(candidate, code) {
    const cellReady = el => candidate?.type === 'custom-otp' ? elementShown(el) : visible(el);
    if (!candidate || !candidate.inputs.every(cellReady) || !/^[A-Za-z0-9]{4,8}$/.test(code)) return false;
    if (candidate.type === 'group' && code.length !== candidate.inputs.length) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter && candidate.inputs.some(input => input.tagName === 'INPUT')) return false;
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const slots = candidate.slots ?? (candidate.type === 'single' ? findDecorativeSlotsContainer(candidate.inputs[0])?.slots ?? null : null);
    const slotsMatch = () => Boolean(slots?.length && slots.map(s => (s.textContent ?? '').trim()).join('') === code);
    const matches = () => (candidate.type !== 'custom-otp' && candidate.inputs.every((input, index) =>
      (input.tagName === 'INPUT' ? input.value : input.textContent) === (candidate.type === 'group' ? code[index] : code))) || slotsMatch();

    if (candidate.type === 'custom-otp') {
      const target = candidate.inputs[0];
      target.focus();
      await settle();
      dispatchPasteEvent(target, code);
      await settle();
      if (slotsMatch()) return true;
      for (const ch of code) {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
        try {
          target.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch }));
        } catch { /* ignore */ }
        target.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        await settle();
      }
      return slotsMatch();
    }

    if (candidate.type === 'single' && slots?.length) {
      const target = candidate.inputs[0];
      target.focus();
      await settle();
      if (!cellReady(target)) return false;
      const paste = dispatchPasteEvent(target, code);
      await settle();
      if (slotsMatch() || (paste.defaultPrevented && target.value === code)) return true;
    }

    if (candidate.type === 'group') {
      // React OTP components can accept the whole code atomically through paste.
      candidate.inputs[0].focus();
      await settle();
      if (!candidate.inputs.every(cellReady)) return false;
      const paste = dispatchPasteEvent(candidate.inputs[0], code);
      await settle();
      if (matches()) return true;
      const anyPopulated = candidate.inputs.some(el => (el.tagName === 'INPUT' ? (el.value ?? '') : (el.textContent ?? '')).length > 0);
      if (paste.defaultPrevented && anyPopulated) return false;
    }
    for (const [index, input] of candidate.inputs.entries()) {
      if (!candidate.inputs.every(cellReady)) return false;
      const value = candidate.type === 'group' ? code[index] : code;
      input.focus();
      await settle();
      if (!candidate.inputs.every(cellReady)) return false;
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
    if (!slots?.length) return matches();
    if (slotsMatch()) return true;

    const target = candidate.inputs[0];
    if (slots.every(s => !(s.textContent ?? '').trim())) {
      if (setter && cellReady(target)) {
        setter.call(target, '');
        target.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();
      }
      for (const ch of code) {
        if (!cellReady(target)) return false;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
        if (setter) {
          setter.call(target, `${target.value ?? ''}${ch}`);
          const inputEvent = typeof InputEvent === 'function' ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }) : new Event('input', { bubbles: true });
          target.dispatchEvent(inputEvent);
        }
        target.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        await settle();
      }
      target.dispatchEvent(new Event('change', { bubbles: true }));
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
