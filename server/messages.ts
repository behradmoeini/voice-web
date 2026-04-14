/** Site copy (English only) */

export type PackageFeatureLine = { plain: string; tech?: string };

export type PackageCopy = {
  name: string;
  summary: string;
  features: PackageFeatureLine[];
  priceLabel: string;
  priceNote?: string;
  highlight?: boolean;
  badge?: string;
};

export type FaqItem = { q: string; a: string };

export type PrinciplesSection = { title: string; paragraphs: string[] };

export type Messages = {
  brand: { name: string };
  nav: {
    home: string;
    services: string;
    about: string;
    faq: string;
    contact: string;
    book: string;
    inquire: string;
    menu: string;
    close: string;
    primaryNav: string;
    footerNav: string;
  };
  skip: { main: string };
  assistant: {
    openLabel: string;
    closeLabel: string;
    title: string;
    subtitle: string;
    welcome: string;
    placeholder: string;
    send: string;
    stop: string;
    chipServices: string;
    chipBook: string;
    chipFaq: string;
    chipContact: string;
    chipPricing: string;
    errorUnavailable: string;
    errorGeneric: string;
    errorDetailLabel: string;
    devHint: string;
  };
  home: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
    heroImageAlt: string;
    eyebrow: string;
    headline: string;
    subhead: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  portfolio: {
    kicker: string;
    heading: string;
    intro: string;
    marqueeRegionLabel: string;
  };
  faqPage: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
    kicker: string;
    pageH1: string;
    intro: string;
    items: FaqItem[];
  };
  principlesPage: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
    pageH1: string;
    intro: string;
    sections: PrinciplesSection[];
    practicesTitle: string;
    practices: string[];
  };
  services: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
    introImageAlt: string;
    pageTitle: string;
    intro: string;
    packagesSr: string;
    packages: Record<"basic" | "professional" | "custom", PackageCopy>;
  };
  about: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
    eyebrow: string;
    pageTitle: string;
    imageAlt: string;
    lead: string;
    followUp: string[];
    principlesCta: string;
  };
  contact: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
    ogDescShort: string;
    pageTitle: string;
    lead: string;
    contactAside: string;
    socialIntro: string;
    social: {
      listLabel: string;
      linkPending: string;
      labels: {
        linkedin: string;
        instagram: string;
        youtube: string;
        facebook: string;
      };
    };
    labels: {
      name: string;
      email: string;
      company: string;
      package: string;
      message: string;
    };
    packageOptions: {
      placeholder: string;
      basic: string;
      professional: string;
      custom: string;
      unsure: string;
    };
    consent: string;
    submit: string;
    sending: string;
    success: string;
    errorNotConfigured: string;
    errorGeneric: string;
  };
  book: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
    pageTitle: string;
    lead: string;
    serviceLine: string;
    dateLabel: string;
    calendarBusyHint: string;
    slotsLabel: string;
    noSlots: string;
    tzNote: string;
    labels: {
      name: string;
      email: string;
      message: string;
    };
    submit: string;
    submitting: string;
    success: string;
    errorSlotTaken: string;
    errorGeneric: string;
    errorAvailability: string;
    errorCalendarSync: string;
    errorCalendarBusy: string;
    errorBookingRequiresGoogle: string;
    errorCalendarWriteFailed: string;
    errorNotConfigured: string;
    errorEmailFailed: string;
    errorEmailSenderRequiresVerifiedDomain: string;
    errorValidation: string;
    errorSlotPast: string;
    errorNetwork: string;
    errorPaymentNotConfigured: string;
    durationLabel: string;
    duration30: string;
    duration60: string;
    duration90: string;
  };
  bookInvoice: {
    title: string;
    description: string;
    pageTitle: string;
    lead: string;
    appointment: string;
    duration: string;
    minutes: string;
    amountDue: string;
    cad: string;
    noPayment: string;
    payOnline: string;
    payNote: string;
    paidThankYou: string;
    payGetLink: string;
    payPreparing: string;
    paymentConfirming: string;
    payRegenerateLink: string;
    checkoutError: string;
    loading: string;
    notFound: string;
    errorGeneric: string;
    backToBook: string;
    cancelledBanner: string;
  };
  footer: {
    blurb: string;
    rights: string;
  };
};

export const messages: Messages = {
  brand: { name: "Praxify" },
  nav: {
    home: "Home",
    services: "Services",
    about: "About",
    faq: "FAQ",
    contact: "Contact",
    book: "Book a call",
    inquire: "Scope your build",
    menu: "Menu",
    close: "Close",
    primaryNav: "Primary",
    footerNav: "Footer",
  },
  skip: { main: "Skip to main content" },
  assistant: {
    openLabel: "Open Praxify assistant",
    closeLabel: "Close assistant",
    title: "Praxify assistant",
    subtitle: "Services, booking & site help",
    welcome:
      "Ask how we work, compare packages, or get pointed to booking and contact. I only answer from this site’s information.",
    placeholder: "Ask anything about Praxify…",
    send: "Send",
    stop: "Stop",
    chipServices: "What do you offer?",
    chipBook: "How do I book a call?",
    chipFaq: "Common questions",
    chipContact: "How do I reach you?",
    chipPricing: "What does it cost?",
    errorUnavailable:
      "The assistant is not configured on this server yet. Use the contact form or email hello@praxify.ca.",
    errorGeneric: "Something went wrong. Try again or use the contact form.",
    errorDetailLabel: "Technical detail",
    devHint:
      "Tip: run npm run dev:vercel locally so /api/chat-assistant works, and set OPENAI_API_KEY.",
  },
  home: {
      title: "Praxify — AI & green software engineering",
      description:
        "We combine artificial intelligence with green software engineering to build fast, efficient, environmentally responsible applications—so you can innovate with a smaller carbon footprint.",
      ogTitle: "Praxify — Intelligent, efficient, green software",
      ogDescription:
        "AI-driven development and green engineering: lean code, optimized infrastructure, and insight into energy and carbon impact.",
      heroImageAlt:
        "Team collaborating at laptops — building software with performance and sustainability in mind",
      eyebrow: "Artificial intelligence · Green software engineering",
      headline: "Intelligent, efficient, and green.",
      subhead:
        "At Praxify, we are redefining what it means to build software in the modern world. We combine the power of artificial intelligence with the principles of green software engineering to create applications that are fast, efficient, and environmentally responsible.",
      ctaPrimary: "Book a call",
      ctaSecondary: "Contact us",
    },
    portfolio: {
      kicker: "Trusted partners",
      heading: "Organizations we’ve built with",
      intro:
        "Teams and businesses we’ve shipped alongside—from discovery through launch. We plan in the open, iterate with your feedback, and hand off code and documentation you can run—whether the engagement is a focused site or a deeper product slice.",
      marqueeRegionLabel: "Partner logos, scrolling horizontally",
    },
    faqPage: {
      title: "Common Questions — Praxify",
      description:
        "Short answers on green engineering, AI-assisted delivery, timelines, payments, and support after launch.",
      ogTitle: "Common Questions — Praxify",
      ogDescription:
        "Common questions: sustainable software, AI in delivery, Basic through Custom packages, and what to expect from kickoff to handoff.",
      kicker: "FAQ",
      pageH1: "Common Questions",
      intro:
        "Quick answers on how we work. For package details, see the Services section above—or send us a note.",
      items: [
        {
          q: "What does green software mean here?",
          a: "Lean, efficient builds: right-sized hosting, solid performance, and less wasted compute. On Custom engagements we can add visibility into usage or carbon impact when it helps you decide what to run and where. Practical outcomes first—not greenwashing.",
        },
        {
          q: "How do you use AI?",
          a: "To move faster with quality: structuring copy, SEO and accessibility passes, integration scaffolding, and careful refactors—with human review on anything customer-facing or sensitive. AI supports the team; it doesn’t replace your judgment.",
        },
        {
          q: "What do I need to start?",
          a: "Who you serve, what you sell, tools you already use, sites you like as reference, logo and colors if you have them, and draft text—or we scope writing help. We’ll say clearly when we need domain or DNS access.",
        },
        {
          q: "How long does delivery take?",
          a: "Basic and Professional usually land in about four to ten weeks, depending on content and integrations. Custom work gets a schedule after discovery, once payments, workflows, and integrations are spelled out.",
        },
        {
          q: "What’s included in payment setup?",
          a: "At minimum: customers can pay online with receipts. Higher tiers add subscriptions, catalogs, deposits, or tax and shipping rules—each captured in writing and tested with your finance process.",
        },
        {
          q: "What happens after launch?",
          a: "Handoff notes, how to request updates, and monitoring guidance. Many teams add a light retainer for changes, tuning, or new integrations—common on Custom, including efficiency-focused follow-ups when useful.",
        },
      ],
    },
    principlesPage: {
      title: "Principles — Praxify",
      description:
        "How we scope work, keep humans in control of automation, and stay accountable from discovery to handoff.",
      ogTitle: "Principles — Praxify",
      ogDescription:
        "Outcomes first, plain documentation, and one accountable lead—how Praxify delivers governed automation.",
      pageH1: "Principles",
      intro:
        "These are the commitments behind how we scope, build, and hand off work—so automation stays useful and accountable, not a black box.",
      sections: [
        {
          title: "Outcomes before tooling",
          paragraphs: [
            "Your operating model and risk boundaries come first. We choose tools and patterns that fit how approvals actually flow in your business—not whatever is loudest in the news cycle.",
            "Accessibility, performance, and plain-language documentation are part of reliability. We treat them as shipping criteria, not optional polish.",
          ],
        },
        {
          title: "Scope you can sign",
          paragraphs: [
            "Scope, acceptance tests, and dates are written so trade-offs are visible before heavy build commitments. You should always know what “done” means and what happens if priorities shift.",
          ],
        },
        {
          title: "Who does the work",
          paragraphs: [
            "Engagements are led by the studio principal; specialists in copy, data, or deep integrations join only when the brief demands it. You retain one accountable contact from discovery through handoff.",
          ],
        },
      ],
      practicesTitle: "What we practice on every project",
      practices: [
        "Observable workflows and written acceptance criteria—not opaque black boxes.",
        "Customer-facing experiments stay off-stage until you approve how they read and behave.",
        "Handoffs include runbooks and controls your team can operate without us in the loop daily.",
      ],
    },
    services: {
      title: "Services — Praxify",
      description:
        "Three levels from credible web presence to governed workflows and deep integrations. Outcomes first; technical depth when it helps you choose.",
      ogTitle: "Services — Basic, Professional & Custom",
      ogDescription:
        "Basic through Custom: what your customers see, what runs in the background, and where humans stay in control—stated plainly.",
      introImageAlt:
        "Laptop showing analytics and operational dashboards — measurable outcomes",
      pageTitle: "Services",
      intro:
        "These tiers are anchors, not cages—the right mix emerges in one focused conversation. Copy below is for decision-makers: customer impact first, implementation detail second, always tied to approvals and accountability you can enforce.",
      packagesSr: "Service packages",
      packages: {
        basic: {
          name: "Basic – Credible Presence",
          summary:
            "Get a disciplined, polished website that builds trust and sets the stage for deeper automation or commerce in the future.\n\nPerfect for businesses looking to establish a credible online presence quickly.",
          features: [
            {
              plain:
                "A polished first impression: Homepage plus up to 3 key page templates tailored to your business.",
            },
            {
              plain:
                "Responsive design: Looks great on phones, tablets, and laptops without extra adjustments.",
            },
            {
              plain:
                "Lead capture that works: Simple contact paths that reduce spam while delivering a great user experience.",
            },
            {
              plain:
                "Future-ready content structure: Semantic page organization for easy integration with notifications, CRM, or automation later.",
            },
            {
              plain:
                "Guidance on domain & hosting: Vendor-agnostic setup checklist so billing stays in your control.",
            },
            {
              plain:
                "Refinement pass: One coordinated round to polish wording and visuals.",
            },
            {
              plain:
                "Team walkthrough: Learn how to request updates, with light CMS editing and handoff notes included.",
            },
            {
              plain:
                "Full support: Keep your website live, secure, and up-to-date effortlessly.",
            },
          ],
          priceLabel: "From $249.99/month",
        },
        professional: {
          name: "Professional – Intelligent Engagement",
          summary:
            "For businesses ready to engage visitors smarter and begin leveraging automation, while maintaining a polished, professional online presence.\n\nPerfect for businesses looking to grow leads, engage visitors efficiently, and explore automated workflows while keeping a professional edge.",
          features: [
            {
              plain:
                "Everything in the Basic Package – polished homepage, responsive design, lead capture, content structure, and support.",
            },
            {
              plain:
                "Additional pages or custom sections – up to 6 pages total to showcase your offerings.",
            },
            {
              plain:
                "AI-assisted content optimization – improve SEO, readability, and accessibility for better engagement.",
            },
            {
              plain:
                "Professional email setup – custom domain email address and full Google Workspace integration.",
            },
            {
              plain:
                "Booking & scheduling system – sync appointments directly to your calendar for seamless client management.",
            },
            {
              plain:
                "Professional VoIP service – dedicated business phone number for calls and texts, optimized for remote work and travel.",
            },
          ],
          priceLabel: "From $399.99/month",
        },
        custom: {
          name: "Custom – Automation & Integration",
          summary:
            "For operations that outgrow standard packages: payments, deep integrations, workflows, and AI—scoped in discovery and built with efficiency in mind.\n\nPerfect for teams that need tailored systems, clear accountability, and measurable outcomes from their stack.",
          features: [
            {
              plain:
                "Everything in the Professional Package – pages, engagement tools, email, booking, VoIP, and support; extended into custom automation and integrations.",
            },
            {
              plain:
                "Payments & invoicing – gateways, subscriptions, and billing flows aligned with finance and testing.",
            },
            {
              plain:
                "Workflow automation & integrations – CRM handoffs, approvals, Slack, calendars, marketing tools, and the platforms you already rely on.",
            },
            {
              plain:
                "Dashboards, analytics & reporting – KPIs, operations data, and optional sustainability or efficiency signals.",
            },
            {
              plain:
                "AI-assisted experiences – chatbots, recommendations, and assistive flows within guardrails you approve.",
            },
            {
              plain:
                "Optional from discovery – custom web apps, APIs, CI/CD, cloud migration, and green-engineering tuning (quoted separately).",
            },
          ],
          priceLabel: "On Demand / Quote-Based",
        },
      },
    },
    about: {
      title: "About — Praxify",
      description:
        "We help businesses innovate while reducing their carbon footprint—with AI-driven tools, lean software, and insight into energy and carbon impact.",
      ogTitle: "About Praxify",
      ogDescription:
        "Measurable sustainability: high-performance applications and smarter technology decisions for business and planet.",
      eyebrow: "Who we are",
      pageTitle: "About us",
      imageAlt:
        "Colleagues working together — sustainable, high-performance software delivery",
      lead:
        "Our mission is simple: help businesses innovate while reducing their carbon footprint. By leveraging AI-driven development tools, we optimize code, infrastructure, and cloud usage—ensuring that every line of software is lean, performant, and energy-conscious.",
      followUp: [
        "We don't just deliver software; we deliver measurable sustainability. Our clients gain high-performance applications alongside insights into energy consumption and carbon impact, empowering them to make technology decisions that are smarter for both business and planet.",
        "At Praxify, we believe that the future of software should be intelligent, efficient, and green.",
      ],
      principlesCta: "Learn our principles & how we build",
    },
    contact: {
      title: "Contact — Praxify",
      description:
        "Tell us what you sell, how work flows today, and which package is closest—we reply within one business day.",
      ogTitle: "Contact — Praxify",
      ogDescription: "Request a strategy session or a written proposal.",
      ogDescShort: "Request a strategy session or a written proposal.",
      pageTitle: "Contact",
      lead: "Describe your offer, timeline, tools you rely on, and where automation could help—or must not go. We respond within one business day with next steps, or propose a short session if the thread needs it.",
      contactAside:
        "If you already have a hard deadline or compliance constraints, mention them in your message—we’ll tailor the reply (or suggest a short call) so you’re not guessing next steps.",
      socialIntro:
        "We’re standing up our social channels; once each profile is live, the icons below will link straight there. Until then, email or the form is the fastest way to reach us.",
      social: {
        listLabel: "Praxify on social media",
        linkPending: "Link not published yet",
        labels: {
          linkedin: "Praxify on LinkedIn",
          instagram: "Praxify on Instagram",
          youtube: "Praxify on YouTube",
          facebook: "Praxify on Facebook",
        },
      },
      labels: {
        name: "Name",
        email: "Email",
        company: "Company",
        package: "Closest package",
        message: "Message",
      },
      packageOptions: {
        placeholder: "Select…",
        basic: "Basic",
        professional: "Professional",
        custom: "Custom",
        unsure: "Not sure yet",
      },
      consent:
        "I agree to be contacted about this inquiry and understand how my information will be used.",
      submit: "Send message",
      sending: "Sending…",
      success: "Thank you—your message was sent. We’ll follow up shortly.",
      errorNotConfigured:
        "The form isn’t connected yet. Please email us directly—we respond within one business day.",
      errorGeneric:
        "Something went wrong. Try again or email us directly.",
    },
    book: {
      title: "Book a call — Praxify",
      description:
        "Pick a weekday time for a strategy session. You’ll get a confirmation email with the details.",
      ogTitle: "Book a strategy session",
      ogDescription:
        "Choose a date and time; we confirm by email.",
      pageTitle: "Book a strategy session",
      lead:
        "Choose how long you need (30 minutes is complimentary; longer sessions are billed in CAD). Then pick a weekday time—shown in Eastern Time.",
      serviceLine: "Strategy & scoping sessions",
      dateLabel: "Date",
      calendarBusyHint:
        "Weekdays with a dot still have open slots unless every time is taken.",
      slotsLabel: "Available times",
      noSlots: "No times left this day—try another weekday.",
      tzNote: "All times are US Eastern (New York).",
      labels: {
        name: "Name",
        email: "Email",
        message: "Notes (optional)",
      },
      submit: "Confirm booking",
      submitting: "Booking…",
      success:
        "You’re booked—we’ve sent a confirmation to your email. If you don’t see it within a few minutes, check spam.",
      errorSlotTaken:
        "That time was just taken. Please pick another slot.",
      errorGeneric:
        "We couldn’t complete the booking. Try again or contact us by email.",
      errorAvailability: "Couldn’t load availability. Refresh and try again.",
      errorCalendarSync:
        "Couldn’t sync with our calendar. Try again shortly, or contact us if this keeps happening.",
      errorCalendarBusy:
        "That time isn’t available on our calendar. Please pick another slot.",
      errorBookingRequiresGoogle:
        "Bookings use Google Calendar only. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_CALENDAR_REFRESH_TOKEN on the server (see .env.example), then redeploy.",
      errorCalendarWriteFailed:
        "Couldn’t create the booking on Google Calendar (often “Insufficient Permission”). Run npm run google-calendar:oauth after adding scope https://www.googleapis.com/auth/calendar in Google Cloud → OAuth consent screen, then put the new refresh token in Vercel.",
      errorNotConfigured:
        "Booking email isn’t configured on the server yet. Add RESEND_API_KEY and BOOKING_FROM_EMAIL, or run with vercel dev and env vars.",
      errorEmailFailed:
        "The confirmation email didn’t send, so the booking was not kept. Fix your Resend sender/domain and try again.",
      errorEmailSenderRequiresVerifiedDomain:
        "We couldn’t send the confirmation email from a valid address. In Vercel, set BOOKING_PUBLIC_BASE_URL to your site (e.g. https://praxify.ca) and verify that domain in Resend, or set RESEND_FROM / BOOKING_FROM_EMAIL to an address on your verified domain. Your Gmail can stay in BOOKING_FROM_EMAIL for reply-to.",
      errorValidation:
        "Please check the form—something didn’t validate. Pick a time slot and try again.",
      errorSlotPast:
        "That time is no longer available. Pick a future slot.",
      errorNetwork:
        "Couldn’t reach the server. Check your connection and try again.",
      errorPaymentNotConfigured:
        "Card payment isn’t set up on the server yet for paid sessions. Add STRIPE_SECRET_KEY (or static pay links in .env.example), redeploy, then try again.",
      durationLabel: "Session length",
      duration30: "30 minutes — included",
      duration60: "60 minutes — paid",
      duration90: "90 minutes — paid",
    },
    bookInvoice: {
      title: "Booking receipt — Praxify",
      description: "Receipt for your scheduled session.",
      pageTitle: "Booking receipt",
      lead: "Here’s a summary of your appointment and any amount due.",
      appointment: "When",
      duration: "Length",
      minutes: "minutes",
      amountDue: "Amount due",
      cad: "CAD",
      noPayment: "No payment due for this session.",
      payOnline: "Pay now with card",
      payNote:
        "You’ll complete payment on Stripe’s secure page (cards accepted in Canada and internationally).",
      paidThankYou:
        "We’ve received your payment. You’re all set for this appointment.",
      payGetLink: "Get payment link",
      payPreparing: "Preparing secure checkout…",
      paymentConfirming:
        "Confirming your payment—this usually takes a few seconds.",
      payRegenerateLink: "Need a fresh checkout link?",
      checkoutError:
        "We couldn’t start checkout. Confirm STRIPE_SECRET_KEY is set on the server and redeploy.",
      loading: "Loading receipt…",
      notFound: "We couldn’t find this receipt. Check the link or book again.",
      errorGeneric: "Something went wrong loading this page.",
      backToBook: "Book another time",
      cancelledBanner:
        "This appointment was cancelled. The time slot may be open again on the booking page.",
    },
    footer: {
      blurb:
        "Praxify builds credible customer journeys and the governed automation behind them—so your team ships work without losing control.",
      rights: "All rights reserved.",
    },
};

export const PACKAGE_ORDER = ["basic", "professional", "custom"] as const;

export type PackageId = (typeof PACKAGE_ORDER)[number];
