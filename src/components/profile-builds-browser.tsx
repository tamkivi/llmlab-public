"use client";

import Link from "next/link";
import { useState } from "react";
import { RecommendationQuiz } from "@/components/recommendation-quiz";

type Profile = {
  key: string;
  name: string;
  target: string;
  priority: string;
  workload: string;
};

const categoryLabelByProfileKey: Record<string, { en: string; et: string }> = {
  "local-llm-inference": { en: "Chat with AI", et: "Vestle tehisaruga" },
  "llm-finetune-starter": { en: "Teach your model", et: "Õpeta oma mudelit" },
  "hybrid-ai-gaming": { en: "Work and play", et: "Töö ja mäng" },
  "workstation-ai": { en: "Big AI jobs", et: "Suured tehisaru tööd" },
};

const ctaByProfileKey: Record<string, { en: string; et: string }> = {
  "local-llm-inference": { en: "See inference builds →", et: "Vaata kohaliku käitamise komplekte →" },
  "llm-finetune-starter": { en: "See fine-tuning builds →", et: "Vaata peenhäälestuse komplekte →" },
  "hybrid-ai-gaming": { en: "See hybrid builds →", et: "Vaata hübriidkomplekte →" },
  "workstation-ai": { en: "See workstation systems →", et: "Vaata tööjaamu ja multi-GPU süsteeme →" },
};

export function ProfileBuildsBrowser({ profiles, lang }: { profiles: Profile[]; lang?: string }) {
  const isEt = lang === "et";
  const [quizOpen, setQuizOpen] = useState(false);

  return (
    <section className="mt-20">
      <p className="label-pill inline-block mb-5">
        {isEt ? "Komplekti kategooriad" : "Build categories"}
      </p>
      <h2 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
        {isEt ? "Vali kategooria, mis sulle kõige paremini sobib" : "Pick which category suits you the best"}
      </h2>
      <p className="mt-5 text-sm font-semibold text-[color:var(--muted)]">
        {isEt ? "Leia arvuti selle järgi, mida soovid tehisaruga teha." : "Pick a computer based on what you want to do with AI."}
      </p>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 lg:grid-cols-3">
        {profiles.map((profile, index) => (
          <Link
            key={profile.key}
            href={`/profiles/${profile.key}`}
            className="product-card stagger-in flex min-h-52 flex-col p-5 text-left md:p-6"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <p className="category-tag inline-block">
                {categoryLabelByProfileKey[profile.key]?.[isEt ? "et" : "en"] ?? (isEt ? "Komplekti kategooria" : "Build Category")}
              </p>
            <h2 className="font-display mt-4 text-base font-semibold md:text-lg">{profile.name}</h2>
            <p className="mt-3 text-xs leading-5 text-[color:var(--muted)]">{profile.target}</p>
            <p className="mt-3 rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--background)]/30 px-3 py-2 text-xs font-semibold leading-5 text-[color:var(--foreground)]">
              {profile.workload}
            </p>
            <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">{profile.priority}</p>
            <p className="mt-auto pt-5 text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
              {ctaByProfileKey[profile.key]?.[isEt ? "et" : "en"] ?? "View builds →"}
            </p>
          </Link>
        ))}
        <Link
          href="/profiles/macos-systems"
          className="product-card stagger-in flex min-h-52 flex-col p-5 text-left md:p-6"
          style={{ animationDelay: `${profiles.length * 100}ms` }}
        >
          <p className="category-tag inline-block">{isEt ? "Lihtne Mac" : "Easy Mac setup"}</p>
          <h2 className="font-display mt-4 text-base font-semibold">{isEt ? "macOS-il põhinevad süsteemid" : "macOS-based systems"}</h2>
          <p className="mt-3 text-xs leading-5 text-[color:var(--muted)]">{isEt ? "Apple Siliconiga Mac minid" : "Apple Silicon Mac minis"}</p>
          <p className="mt-3 rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--background)]/30 px-3 py-2 text-xs font-semibold leading-5 text-[color:var(--foreground)]">
            {isEt ? "Parim 7B/13B mudeliteks; suuremad sõltuvad ühtsest mälust" : "Best for 7B/13B models; larger models depend on unified memory"}
          </p>
          <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">{isEt ? "Eraldi GPU-d pole vaja" : "No GPU required"}</p>
          <p className="mt-auto pt-5 text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
            {isEt ? "Vaata Maci süsteeme →" : "See Mac systems →"}
          </p>
        </Link>
        <Link
          href="/profiles/mac-egpu-ai"
          className="product-card stagger-in flex min-h-52 flex-col border-yellow-400/30 p-5 text-left md:p-6"
          style={{ animationDelay: `${(profiles.length + 1) * 100}ms` }}
        >
          <p className="category-tag inline-block !border-yellow-400/50 !text-yellow-400">{isEt ? "Eksperimentaalne" : "Experimental"}</p>
          <h2 className="font-display mt-4 text-base font-semibold">{isEt ? "Mac + väline GPU tehisaruks" : "Mac + External GPU AI"}</h2>
          <p className="mt-3 text-xs leading-5 text-[color:var(--muted)]">Apple Silicon + NVIDIA/AMD eGPU</p>
          <p className="mt-3 rounded-lg border border-yellow-400/25 bg-yellow-400/5 px-3 py-2 text-xs font-semibold leading-5 text-yellow-100">
            {isEt ? "Eksperimentaalne VRAM-i tee 30B/70B katsetusteks" : "Experimental VRAM path for 30B/70B exploration"}
          </p>
          <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">{isEt ? "Ainult tehisaru arvutuseks" : "AI compute only"}</p>
          <p className="mt-auto pt-5 text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
            {isEt ? "Vaata Mac eGPU seadistusi →" : "See Mac eGPU AI setup →"}
          </p>
        </Link>
      </div>

      <div
        className="purchase-panel mt-14 p-7 md:p-9"
        style={{
          boxShadow:
            "0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent), 0 0 40px color-mix(in srgb, var(--accent) 15%, transparent)",
        }}
      >
        <h2 className="font-display text-3xl font-semibold">
          {isEt ? "Ei ole kindel, milline kategooria sulle sobib?" : "Not sure which category fits you best?"}
        </h2>
        <p className="mt-5 max-w-2xl leading-7 text-[color:var(--muted)]">
          {isEt
            ? "Vasta mõnele küsimusele ja soovitame sinu mudelite, eelarve ja töökoormuse jaoks sobivaima komplekti."
            : "Answer a few questions and we'll recommend the best build for your models, budget, and workload."}
        </p>

        {!quizOpen ? (
          <button
            type="button"
            data-release-scroll-story
            onClick={() => setQuizOpen(true)}
            className="btn-primary glow-pulse mt-12 inline-flex items-center gap-2 text-sm transition hover:-translate-y-0.5 md:text-base"
          >
            {isEt ? "Leia sobivaim komplekt →" : "Find my ideal build →"}
          </button>
        ) : (
          <div className="mt-10">
            <RecommendationQuiz lang={lang ?? "en"} />
          </div>
        )}
      </div>
    </section>
  );
}
