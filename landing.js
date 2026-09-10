/**
 * NFC Recenzie - Landing Page Logic & Interactivity
 * (Review Simulator, Dynamic Calculator, Order Form, Login Modal)
 */

document.addEventListener("DOMContentLoaded", () => {
  // ----------------------------------------------------
  // 1. Login Modal (Vstup pre obchodníkov do portálu)
  // ----------------------------------------------------
  const portalLoginBtn = document.getElementById("portalLoginBtn");
  const footerLoginLink = document.getElementById("footerLoginLink");
  const loginModal = document.getElementById("loginModal");
  const closeLoginModal = document.getElementById("closeLoginModal");
  const modalAuthForm = document.getElementById("modalAuthForm");
  const modalPinInput = document.getElementById("modalPinInput");
  const modalAuthError = document.getElementById("modalAuthError");
  const toggleModalPinBtn = document.getElementById("toggleModalPinBtn");
  const modalAuthSubmitBtn = document.getElementById("modalAuthSubmitBtn");

  const STORAGE_KEY_AUTH = "nfc_portal_auth_token";
  const RATE_LIMIT_KEY = "nfc_portal_rate_limit";
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 60000;

  // SHA-256 hash kryptografické overenie (178155 a nfc2026) – žiadne heslo v čitateľnom texte
  const VALID_PIN_HASHES = [
    "a000162f02adea458d0d0c356713375510a43566b0c6acc93667b172d75a7403", // 178155
    "2fdc85d0c7d28ec1185610f1f3e4fffe0edab2c7ee12d806217e56a4ff2463fe"  // nfc2026 fallback
  ];

  async function hashPin(str) {
    if (!str) return "";
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      return "";
    }
  }

  function checkRateLimit() {
    try {
      const raw = sessionStorage.getItem(RATE_LIMIT_KEY);
      if (!raw) return { locked: false, remainingSec: 0 };
      const data = JSON.parse(raw);
      const now = Date.now();
      if (data.lockUntil && now < data.lockUntil) {
        return { locked: true, remainingSec: Math.ceil((data.lockUntil - now) / 1000) };
      }
      if (data.lockUntil && now >= data.lockUntil) {
        sessionStorage.removeItem(RATE_LIMIT_KEY);
        return { locked: false, remainingSec: 0 };
      }
      return { locked: false, remainingSec: 0, attempts: data.attempts || 0 };
    } catch (e) {
      return { locked: false, remainingSec: 0 };
    }
  }

  function recordFailedAttempt() {
    try {
      const raw = sessionStorage.getItem(RATE_LIMIT_KEY);
      const data = raw ? JSON.parse(raw) : { attempts: 0 };
      data.attempts = (data.attempts || 0) + 1;
      if (data.attempts >= MAX_ATTEMPTS) {
        data.lockUntil = Date.now() + LOCKOUT_MS;
      }
      sessionStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(data));
      return data;
    } catch (e) {
      return { attempts: 1 };
    }
  }

  function resetRateLimit() {
    try {
      sessionStorage.removeItem(RATE_LIMIT_KEY);
    } catch (e) {}
  }

  function openModal() {
    if (loginModal) {
      loginModal.classList.remove("hidden");
      const rate = checkRateLimit();
      if (rate.locked && modalAuthError) {
        modalAuthError.textContent = `⚠️ Príliš veľa pokusov. Skúste znova o ${rate.remainingSec} s.`;
        modalAuthError.classList.remove("hidden");
      } else if (modalAuthError) {
        modalAuthError.classList.add("hidden");
      }
      if (modalPinInput) {
        modalPinInput.value = "";
        modalPinInput.type = "password";
        if (toggleModalPinBtn) toggleModalPinBtn.textContent = "👁️";
        modalPinInput.focus();
      }
    }
  }

  function closeModal() {
    if (loginModal) loginModal.classList.add("hidden");
  }

  if (portalLoginBtn) portalLoginBtn.addEventListener("click", openModal);
  if (footerLoginLink) footerLoginLink.addEventListener("click", openModal);
  if (closeLoginModal) closeLoginModal.addEventListener("click", closeModal);

  if (loginModal) {
    loginModal.addEventListener("click", (e) => {
      if (e.target === loginModal) closeModal();
    });
  }

  if (toggleModalPinBtn && modalPinInput) {
    toggleModalPinBtn.addEventListener("click", () => {
      const isPass = modalPinInput.type === "password";
      modalPinInput.type = isPass ? "text" : "password";
      toggleModalPinBtn.textContent = isPass ? "🙈" : "👁️";
      modalPinInput.focus();
    });
  }

  async function handleModalLogin() {
    const rate = checkRateLimit();
    if (rate.locked) {
      if (modalAuthError) {
        modalAuthError.textContent = `⚠️ Príliš veľa pokusov. Skúste znova o ${rate.remainingSec} s.`;
        modalAuthError.classList.remove("hidden");
      }
      return;
    }

    const raw = modalPinInput ? modalPinInput.value : "";
    const entered = raw.trim().replace(/\s+/g, "");
    if (!entered) return;

    const enteredHash = await hashPin(entered);
    const customHash = localStorage.getItem("nfc_portal_custom_hash");

    const isValid = VALID_PIN_HASHES.includes(enteredHash) || (customHash && enteredHash === customHash);

    if (isValid) {
      resetRateLimit();
      sessionStorage.setItem(STORAGE_KEY_AUTH, "valid");
      localStorage.setItem(STORAGE_KEY_AUTH, "valid");

      const path = window.location.pathname;
      let target = "./portal.html";
      if (!path.endsWith("/") && !path.endsWith(".html")) {
        target = path + "/portal.html";
      }
      window.location.href = target;
    } else {
      const state = recordFailedAttempt();
      if (modalAuthError) {
        if (state.attempts >= MAX_ATTEMPTS) {
          modalAuthError.textContent = "⚠️ Príliš veľa neúspešných pokusov. Prístup je na 60 sekúnd uzamknutý.";
        } else {
          modalAuthError.textContent = `⚠️ Nesprávny PIN. Zostávajúce pokusy: ${MAX_ATTEMPTS - state.attempts}`;
        }
        modalAuthError.classList.remove("hidden");
      }
      if (modalPinInput) {
        modalPinInput.value = "";
        modalPinInput.focus();
      }
    }
  }

  if (modalAuthForm) {
    modalAuthForm.addEventListener("submit", (e) => {
      e.preventDefault();
      handleModalLogin();
    });
  }

  if (modalAuthSubmitBtn) {
    modalAuthSubmitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleModalLogin();
    });
  }

  if (modalPinInput) {
    modalPinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleModalLogin();
      }
    });
  }

  // ----------------------------------------------------
  // 2. Interaktívna simulácia priloženia smartfónu
  // ----------------------------------------------------
  const triggerDemoBtn = document.getElementById("triggerDemoBtn");
  const demoPopup = document.getElementById("demoPopup");
  const closeDemoBtn = document.getElementById("closeDemoBtn");

  if (triggerDemoBtn && demoPopup) {
    triggerDemoBtn.addEventListener("click", () => {
      demoPopup.classList.remove("hidden");
    });
  }

  if (closeDemoBtn && demoPopup) {
    closeDemoBtn.addEventListener("click", () => {
      demoPopup.classList.add("hidden");
    });
  }

  // ----------------------------------------------------
  // 3. Interaktívna kalkulačka recenzií pre podniky
  // ----------------------------------------------------
  const guestsSlider = document.getElementById("guestsSlider");
  const scoreSlider = document.getElementById("scoreSlider");
  const reviewsSlider = document.getElementById("reviewsSlider");

  const guestsDisplay = document.getElementById("guestsDisplay");
  const scoreDisplay = document.getElementById("scoreDisplay");
  const reviewsDisplay = document.getElementById("reviewsDisplay");

  const calcNewReviews = document.getElementById("calcNewReviews");
  const calcWeeksToGoal = document.getElementById("calcWeeksToGoal");
  const calcCustomerGrowth = document.getElementById("calcCustomerGrowth");
  const calcShieldCount = document.getElementById("calcShieldCount");

  function updateCalculator() {
    const dailyGuests = Number(guestsSlider ? guestsSlider.value : 40);
    const currentScore = Number(scoreSlider ? scoreSlider.value : 4.2);
    const currentReviews = Number(reviewsSlider ? reviewsSlider.value : 30);

    if (guestsDisplay) guestsDisplay.textContent = `${dailyGuests} hostí / deň`;
    if (scoreDisplay) scoreDisplay.textContent = `${currentScore.toFixed(1)} ★`;
    if (reviewsDisplay) reviewsDisplay.textContent = `${currentReviews} recenzií`;

    // Konzervatívny odhad: 10% až 15% spokojných hostí priloží mobil k stojančeku
    const monthlyReviews = Math.round(dailyGuests * 30 * 0.08);

    // Výpočet potrebných recenzií na skóre 4.8★
    let neededFor48 = 0;
    if (currentScore < 4.8) {
      neededFor48 = Math.max(1, Math.ceil(((4.8 - currentScore) * currentReviews) / 0.2));
    } else {
      neededFor48 = 10;
    }

    const weeksToGoal = Math.max(1, Math.ceil((neededFor48 / (monthlyReviews / 4.2))));

    // Ochranný štít: koľko 1★ recenzií znesie
    const currentTotalPoints = currentScore * currentReviews;
    let shield = 0;
    for (let bad = 1; bad <= 50; bad++) {
      const simulatedScore = (currentTotalPoints + bad * 1) / (currentReviews + bad);
      if (simulatedScore < 4.5) {
        shield = Math.max(1, bad - 1);
        break;
      }
    }
    if (shield === 0) shield = 1;

    // Odhad rastu návštevnosti z Google Máp
    const growthPercent = Math.min(35, Math.round(15 + (4.8 - Math.min(currentScore, 4.8)) * 25));

    if (calcNewReviews) calcNewReviews.textContent = `+${monthlyReviews}`;
    if (calcWeeksToGoal) calcWeeksToGoal.textContent = `${weeksToGoal} ${weeksToGoal === 1 ? 'týždeň' : (weeksToGoal < 5 ? 'týždne' : 'týždňov')}`;
    if (calcCustomerGrowth) calcCustomerGrowth.textContent = `+${growthPercent} %`;
    if (calcShieldCount) calcShieldCount.textContent = `${shield} ${shield === 1 ? 'negatívnu recenziu' : 'negatívne recenzie'}`;
  }

  if (guestsSlider) guestsSlider.addEventListener("input", updateCalculator);
  if (scoreSlider) scoreSlider.addEventListener("input", updateCalculator);
  if (reviewsSlider) reviewsSlider.addEventListener("input", updateCalculator);
  updateCalculator();

  // ----------------------------------------------------
  // 4. Výber balíka a predvyplnenie formulára
  // ----------------------------------------------------
  const packageSelect = document.getElementById("orderPackage");
  window.selectPackage = function(planName) {
    if (packageSelect) {
      packageSelect.value = planName;
    }
    const orderSection = document.getElementById("objednavka");
    if (orderSection) {
      orderSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  // ----------------------------------------------------
  // 5. Odoslanie objednávky (WhatsApp / E-mail)
  // ----------------------------------------------------
  const orderForm = document.getElementById("orderForm");
  const orderSuccess = document.getElementById("orderSuccess");

  if (orderForm) {
    orderForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const businessName = document.getElementById("orderBusiness").value.trim();
      const city = document.getElementById("orderCity").value.trim();
      const contactName = document.getElementById("orderName").value.trim();
      const phone = document.getElementById("orderPhone").value.trim();
      const pack = document.getElementById("orderPackage").value;
      const note = document.getElementById("orderNote").value.trim();

      const text = `Dobrý deň, mám záujem o NFC stojančeky na Google recenzie:%0A%0A` +
        `• Prevádzka: ${encodeURIComponent(businessName)} (${encodeURIComponent(city)})%0A` +
        `• Balík: ${encodeURIComponent(pack)}%0A` +
        `• Kontaktná osoba: ${encodeURIComponent(contactName)}%0A` +
        `• Telefón: ${encodeURIComponent(phone)}%0A` +
        (note ? `• Poznámka: ${encodeURIComponent(note)}%0A` : '');

      if (orderSuccess) {
        orderSuccess.classList.remove("hidden");
      }

      // Otvoriť WhatsApp s predvyplneným textom
      window.open(`https://wa.me/?text=${text}`, "_blank");
    });
  }

  // ----------------------------------------------------
  // 6. FAQ Akordeón
  // ----------------------------------------------------
  const faqItems = document.querySelectorAll(".faq-item");
  faqItems.forEach((item) => {
    item.addEventListener("click", () => {
      const answer = item.querySelector(".faq-answer");
      const icon = item.querySelector(".faq-toggle-icon");
      if (answer) {
        const isHidden = answer.classList.contains("hidden");
        answer.classList.toggle("hidden");
        if (icon) icon.textContent = isHidden ? "−" : "+";
      }
    });
  });
});
