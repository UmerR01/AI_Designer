/**
 * Aligns Next.js editor behavior with backend/main.py + backend/frontend.html:
 * each project kind maps to ONE websocket pipeline; cross-type prompts are blocked.
 */

export type PromptIntentHint = "logo" | "mobile" | "poster" | "web" | "generic";

export type LockedPipeline =
  | "landing_page"
  | "logo"
  | "social_media"
  | "illustration"
  | "ui"
  | null;

export function inferPromptIntentHint(text: string): PromptIntentHint {
  const t = (text || "").toLowerCase();
  if (/\blogo\b|\bbrand mark\b|\bwordmark\b|\bfavicon\b/.test(t)) return "logo";
  if (/\bmobile\b|\bios\b|\bandroid\b|\bapp screen\b|\bphone\b/.test(t)) return "mobile";
  if (/\bposter\b|\binstagram\b|\bflyer\b|\bbanner\b|\bsocial post\b/.test(t)) return "poster";
  if (/\blanding page\b|\bhomepage\b|\bwebsite\b|\bweb\b|\bdashboard\b|\bdesktop\b/.test(t)) {
    return "web";
  }
  return "generic";
}

/** Backend route family for this project kind (matches getWsEndpointForKind). */
export function getLockedPipelineForKind(kind?: string): LockedPipeline {
  const k = (kind || "").toLowerCase().trim();
  if (k === "landing page") return "landing_page";
  if (k === "logo design") return "logo";
  if (k === "social media design") return "social_media";
  if (
    k === "ui/ux design" ||
    k === "product design" ||
    k === "product design - desktop" ||
    k === "product design - app" ||
    k === "website design" ||
    k === "multi-page website"
  ) {
    return "ui";
  }
  return null;
}

export function usesDedicatedGenerationPipeline(kind?: string): boolean {
  return getLockedPipelineForKind(kind) !== null;
}

export function validatePromptForProjectKind(
  kind: string | undefined,
  text: string,
): { ok: true } | { ok: false; message: string } {
  const locked = getLockedPipelineForKind(kind);
  if (!locked) return { ok: true };

  const hint = inferPromptIntentHint(text);
  if (hint === "generic") return { ok: true };

  if (locked === "landing_page") {
    if (hint === "logo") {
      return {
        ok: false,
        message:
          "I can help you design beautiful landing pages here! Since this is a Landing Page project, logo designs aren't supported. Please create a Logo Design project to generate custom logos.",
      };
    }
    if (hint === "poster") {
      return {
        ok: false,
        message:
          "Since this is a Landing Page project, social media graphics/posters aren't supported. Please create a Social Media Design project to generate those.",
      };
    }
    if (hint === "mobile") {
      return {
        ok: false,
        message:
          "This project is set up specifically for Landing Pages. If you'd like to design mobile app screens or user flows, please create a UI/UX or Product Design project.",
      };
    }
    return { ok: true };
  }

  if (locked === "logo") {
    if (hint === "web" || hint === "mobile") {
      return {
        ok: false,
        message:
          "I can help you design custom brand marks and logos here! Since this is a Logo Design project, full website or mobile screens aren't supported. Please create a UI/UX, Website, or Landing Page project for those layouts.",
      };
    }
    if (hint === "poster") {
      return {
        ok: false,
        message:
          "This project is dedicated to Logo Designs. For social media graphics and marketing posts, please create a Social Media Design project.",
      };
    }
    return { ok: true };
  }

  if (locked === "social_media") {
    if (hint === "logo") {
      return {
        ok: false,
        message:
          "This project is configured for Social Media Design. If you need to generate custom logos or branding marks, please start a Logo Design project.",
      };
    }
    if (hint === "mobile" || hint === "web") {
      return {
        ok: false,
        message:
          "Since this is a Social Media Design project, full app interfaces or website screens aren't supported. Please create a UI/UX or Website project to design them.",
      };
    }
    return { ok: true };
  }

  if (locked === "ui") {
    if (hint === "logo") {
      return {
        ok: false,
        message:
          "This is a UI/UX project. For custom logo designs and brand marks, please create a Logo Design project.",
      };
    }
    if (hint === "poster") {
      return {
        ok: false,
        message:
          "This project is set up for UI/UX layouts. If you want to design marketing posters or social banners, please create a Social Media Design project.",
      };
    }
    return { ok: true };
  }

  return { ok: true };
}

/** Generation spec appended to the query — must match the locked pipeline, not free-form intent. */
export function generationSpecForProjectKind(kind?: string): string {
  const locked = getLockedPipelineForKind(kind);
  if (locked === "landing_page") {
    return [
      "TARGET TYPE: LANDING PAGE",
      "Generate a split-artboard landing page prototype only (two vertical artboards: top + bottom halves).",
      "Do not generate a standalone logo mark, mobile app screens, or social post layout.",
    ].join("\n");
  }
  if (locked === "logo") {
    return [
      "TARGET TYPE: LOGO",
      "Generate logo / brand mark output only.",
      "Do not generate full landing pages, mobile app screens, or social post templates.",
    ].join("\n");
  }
  if (locked === "social_media") {
    return [
      "TARGET TYPE: SOCIAL MEDIA POST",
      "Generate social post / campaign creative layout for the selected platform.",
      "Do not generate full websites, mobile app flows, or isolated logo-only marks unless asked inside the post.",
    ].join("\n");
  }
  return "";
}

export function chatPlaceholderForProjectKind(kind?: string): string {
  const k = (kind || "").toLowerCase().trim();
  if (k === "landing page") {
    return "Describe your landing page (hero, features, pricing, footer)…";
  }
  if (k === "logo design") {
    return "Describe your logo / brand mark…";
  }
  if (k === "social media design") {
    return "Describe your social post (platform, offer, visual style)…";
  }
  return "Describe screen/design requirements…";
}

export function pipelineLabelForProjectKind(kind?: string): string {
  const locked = getLockedPipelineForKind(kind);
  if (locked === "landing_page") return "Landing Page";
  if (locked === "logo") return "Logo";
  if (locked === "social_media") return "Social Media";
  return kind || "Designer";
}
