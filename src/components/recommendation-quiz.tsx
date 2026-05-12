"use client"

import { useState } from "react"
import Link from "next/link"
import { catalogHref, type BudgetFilter, type CatalogFilters, type PlatformFilter, type WorkloadFilter } from "@/lib/catalog-url"
import { QuizProgressBar, QuizOptionButton, QuizBackButton, QuizResultCard, QuizResultHeader, QuizStepCounter } from "./quiz-shared"

type UseCase =
  | "local-llm-inference"
  | "llm-finetune-starter"
  | "stable-diffusion"
  | "ai-coding-agents"
  | "gaming-ai"
  | "macos-workflow"

type BudgetRange = "under-1200" | "1200-2000" | "2000-3500" | "3500-plus"
type Platform = "windows-linux" | "macos" | "no-preference"
type ModelTarget = "7b" | "13b" | "20-34b" | "70b-plus" | "not-sure"
type NoisePreference = "compact-quiet" | "balanced" | "max-performance"

type StepId = "use-case" | "budget" | "platform" | "model-target" | "noise" | "result"

interface QuizAnswers {
  useCase: UseCase | null
  budget: BudgetRange | null
  platform: Platform | null
  modelTarget: ModelTarget | null
  noise: NoisePreference | null
}

interface BuildRecommendation {
  key: string
  name: { en: string; et: string }
  tag: { en: string; et: string }
  description: { en: string; et: string }
  profileKey?: string
}

const STEPS: { id: StepId; num: number }[] = [
  { id: "use-case", num: 1 },
  { id: "budget", num: 2 },
  { id: "platform", num: 3 },
  { id: "model-target", num: 4 },
  { id: "noise", num: 5 },
  { id: "result", num: 6 },
]

const USE_CASES: { value: UseCase; label: { en: string; et: string } }[] = [
  { value: "local-llm-inference", label: { en: "Local LLM inference", et: "Kohaliku LLM-i käitamine" } },
  { value: "llm-finetune-starter", label: { en: "Fine-tuning / LoRA", et: "Peenhäälestus / LoRA" } },
  { value: "stable-diffusion", label: { en: "Stable Diffusion / image generation", et: "Stable Diffusion / pildiloome" } },
  { value: "ai-coding-agents", label: { en: "AI coding / agents", et: "Tehisaru kodeerimisabilised / agendid" } },
  { value: "gaming-ai", label: { en: "Gaming + AI", et: "Mängimine + tehisaru" } },
  { value: "macos-workflow", label: { en: "Mac-based workflow", et: "Maci-põhine töövoog" } },
]

const BUDGETS: { value: BudgetRange; label: { en: string; et: string } }[] = [
  { value: "under-1200", label: { en: "Under €1,200", et: "Alla €1 200" } },
  { value: "1200-2000", label: { en: "€1,200 – €2,000", et: "€1 200 – €2 000" } },
  { value: "2000-3500", label: { en: "€2,000 – €3,500", et: "€2 000 – €3 500" } },
  { value: "3500-plus", label: { en: "€3,500+", et: "€3 500+" } },
]

const PLATFORMS: { value: Platform; label: { en: string; et: string } }[] = [
  { value: "windows-linux", label: { en: "Windows / Linux PC", et: "Windows / Linux PC" } },
  { value: "macos", label: { en: "macOS", et: "macOS" } },
  { value: "no-preference", label: { en: "No preference", et: "Eelistus puudub" } },
]

const MODEL_TARGETS: { value: ModelTarget; label: { en: string; et: string } }[] = [
  { value: "7b", label: { en: "7B", et: "7B" } },
  { value: "13b", label: { en: "13B", et: "13B" } },
  { value: "20-34b", label: { en: "20B – 34B", et: "20B – 34B" } },
  { value: "70b-plus", label: { en: "70B+", et: "70B+" } },
  { value: "not-sure", label: { en: "Not sure", et: "Pole kindel" } },
]

const NOISE_OPTIONS: { value: NoisePreference; label: { en: string; et: string } }[] = [
  { value: "compact-quiet", label: { en: "Compact and quiet", et: "Kompaktne ja vaikne" } },
  { value: "balanced", label: { en: "Balanced", et: "Tasakaalustatud" } },
  { value: "max-performance", label: { en: "Maximum performance", et: "Maksimaalne jõudlus" } },
]

function computeRecommendations(answers: QuizAnswers): BuildRecommendation[] {
  const recs: BuildRecommendation[] = []
  const { useCase, budget, platform, modelTarget, noise } = answers

  if (platform === "macos" || useCase === "macos-workflow") {
    recs.push({
      key: "macos",
      name: { en: "Mac Studio / Mac mini AI Setup", et: "Mac Studio / Mac mini tehisaru seadistus" },
      tag: { en: "Silent local inference", et: "Vaikne kohalik mudelite käitamine" },
      description: {
        en: "Apple Silicon with unified memory. Perfect for quiet local inference, coding assistants, and macOS workflows.",
        et: "Apple Silicon ühtse mäluga. Sobib vaikseks kohalikuks mudelite käitamiseks, kodeerimisabilisteks ja macOS-i töövoogudeks.",
      },
      profileKey: "macos-systems",
    })
    if (budget === "3500-plus" || modelTarget === "70b-plus" || modelTarget === "20-34b") {
      recs.push({
        key: "mac-egpu",
        name: { en: "Mac + External GPU AI Compute", et: "Mac + väline GPU tehisaru arvutuseks" },
        tag: { en: "Experimental", et: "Eksperimentaalne" },
        description: {
          en: "Apple Silicon Mac with external NVIDIA GPU for CUDA AI compute. AI compute only — not for gaming or graphics.",
          et: "Apple Siliconiga Mac välise NVIDIA GPU-ga CUDA-põhisteks tehisaru arvutusteks. Ainult tehisaru arvutuseks — mitte mängudeks ega graafikaks.",
        },
        profileKey: "mac-egpu-ai",
      })
    }
  }

  if (useCase === "gaming-ai") {
    recs.push({
      key: "hybrid",
      name: { en: "Hybrid AI + Gaming", et: "Tehisaru + mängimine" },
      tag: { en: "Two in one", et: "Kaks-ühes" },
      description: {
        en: "Balanced builds for AI development during the day and high-refresh gaming at night.",
        et: "Tasakaalustatud komplektid tehisaru arenduseks päeval ja mängimiseks õhtul.",
      },
      profileKey: "hybrid-ai-gaming",
    })
  }

  if (useCase === "llm-finetune-starter") {
    recs.push({
      key: "finetune",
      name: { en: "LLM Fine-Tune Starter", et: "LLM-i peenhäälestus" },
      tag: { en: "For training", et: "Treenimiseks" },
      description: {
        en: "Platforms with enough system RAM and stable cooling for LoRA adapters and custom training runs.",
        et: "Platvormid piisava süsteemi RAM-i ja stabiilse jahutusega LoRA adapterite ning treeningute jaoks.",
      },
      profileKey: "llm-finetune-starter",
    })
  }

  if (useCase === "local-llm-inference" || useCase === "ai-coding-agents" || useCase === "stable-diffusion" || !useCase) {
    if (modelTarget === "70b-plus" || budget === "3500-plus") {
      recs.push({
        key: "workstation",
        name: { en: "AI Workstations & Multi-GPU Systems", et: "Tehisaru tööjaamad ja multi-GPU süsteemid" },
        tag: { en: "Heavy AI & Multi-GPU", et: "Rasked töökoormused ja multi-GPU" },
        description: {
          en: "Single- and multi-GPU workstation platforms for larger models, multi-session serving, research, and team deployments.",
          et: "Ühe või mitme GPU-ga tööjaamad suuremate mudelite, mitme samaaegse seansi, uurimistöö ja meeskonna kasutuse jaoks.",
        },
        profileKey: "workstation-ai",
      })
    }

    if (recs.length === 0) {
      recs.push({
        key: "local-llm",
        name: { en: "Local LLM Inference", et: "Kohalik LLM" },
        tag: { en: "Most popular", et: "Kõige populaarsem" },
        description: {
          en: "Best for daily AI use, coding assistants, document Q&A, and general model experimentation.",
          et: "Parim igapäevaseks tehisaru kasutuseks, kodeerimisabilistele ja mudelite katsetamiseks.",
        },
        profileKey: "local-llm-inference",
      })
    }
  }

  if (noise === "compact-quiet" && recs.every((r) => r.key !== "macos")) {
    recs.push({
      key: "quiet-office",
      name: { en: "Quiet Office AI Workstation", et: "Vaikne kontori tehisaru tööjaam" },
      tag: { en: "Compact & Quiet", et: "Kompaktne ja vaikne" },
      description: {
        en: "High-performance GPU with noise-conscious case and cooling. Ideal for local LLMs in a work or study environment.",
        et: "Suure jõudlusega GPU vaikse korpuse ja jahutusega. Sobib kohalike LLM-ide jaoks töö- või õpikeskkonnas.",
      },
      profileKey: "local-llm-inference",
    })
  }

  if (recs.length === 0) {
    recs.push({
      key: "local-llm",
      name: { en: "Local LLM Inference", et: "Kohalik LLM" },
      tag: { en: "Most popular", et: "Kõige populaarsem" },
      description: {
        en: "Best for daily AI use, coding assistants, document Q&A, and general model experimentation.",
        et: "Parim igapäevaseks tehisaru kasutuseks, kodeerimisabilistele ja mudelite katsetamiseks.",
      },
      profileKey: "local-llm-inference",
    })
  }

  return recs.slice(0, 3)
}

function budgetFilterFromAnswer(value: BudgetRange | null): BudgetFilter {
  return value ?? "all"
}

function workloadFilterFromAnswer(value: ModelTarget | null): WorkloadFilter {
  if (value === "7b") return "7b"
  if (value === "13b") return "13b"
  if (value === "20-34b") return "30b"
  if (value === "70b-plus") return "70b"
  return "all"
}

function platformFilterFromAnswer(value: Platform | null): PlatformFilter {
  if (value === "windows-linux") return "desktop"
  if (value === "macos") return "mac"
  return "all"
}

function catalogHrefForRecommendation(rec: BuildRecommendation, answers: QuizAnswers) {
  const filters: Partial<CatalogFilters> = {
    budget: budgetFilterFromAnswer(answers.budget),
    workload: workloadFilterFromAnswer(answers.modelTarget),
    platform: platformFilterFromAnswer(answers.platform),
  }

  if (rec.key === "macos") {
    filters.checkout = "quote"
    filters.platform = "mac"
  } else if (rec.key === "mac-egpu") {
    filters.checkout = "quote"
    filters.platform = "mac-egpu"
    filters.workload = answers.modelTarget === "70b-plus" ? "70b" : "30b"
  } else if (rec.key === "workstation") {
    filters.budget = "3500-plus"
    filters.platform = "desktop"
    filters.vram = "48"
    filters.ram = "128"
    filters.workload = "70b"
  } else if (rec.key === "finetune") {
    filters.platform = "desktop"
    filters.ram = "64"
    filters.workload = filters.workload === "all" ? "13b" : filters.workload
  } else if (rec.key === "hybrid") {
    filters.platform = "desktop"
    filters.workload = filters.workload === "all" ? "13b" : filters.workload
  } else if (rec.key === "local-llm" || rec.key === "quiet-office") {
    filters.platform = filters.platform === "mac" ? "all" : filters.platform
    filters.workload = filters.workload === "all" ? "13b" : filters.workload
  }

  return catalogHref({ filters })
}

export function RecommendationQuiz({ lang }: { lang: string }) {
  const isEt = lang === "et"
  const [currentStep, setCurrentStep] = useState<StepId>("use-case")
  const [answers, setAnswers] = useState<QuizAnswers>({
    useCase: null,
    budget: null,
    platform: null,
    modelTarget: null,
    noise: null,
  })

  const stepInfo = STEPS.find((s) => s.id === currentStep)!
  const progress = currentStep === "result" ? 5 : stepInfo.num

  function selectAnswer<K extends keyof QuizAnswers>(key: K, value: QuizAnswers[K]) {
    const next = { ...answers, [key]: value }
    setAnswers(next)

    const stepOrder: StepId[] = ["use-case", "budget", "platform", "model-target", "noise"]
    const currentIdx = stepOrder.indexOf(currentStep)
    if (currentIdx < stepOrder.length - 1) {
      setCurrentStep(stepOrder[currentIdx + 1])
    } else {
      setCurrentStep("result")
    }
  }

  function goBack() {
    const stepOrder: StepId[] = ["use-case", "budget", "platform", "model-target", "noise", "result"]
    const currentIdx = stepOrder.indexOf(currentStep)
    if (currentIdx > 0) {
      setCurrentStep(stepOrder[currentIdx - 1])
    }
  }

  function reset() {
    setCurrentStep("use-case")
    setAnswers({
      useCase: null,
      budget: null,
      platform: null,
      modelTarget: null,
      noise: null,
    })
  }

  const recommendations = currentStep === "result" ? computeRecommendations(answers) : []

  return (
    <div>
      <QuizProgressBar total={5} progress={progress} className="mb-4" />

      {currentStep !== "result" && (
        <QuizStepCounter current={progress} total={5} isEt={isEt} />
      )}

      {currentStep === "use-case" && (
        <>
          <h3 className="font-display text-xl font-semibold mb-1">
            {isEt ? "Mida sa peamiselt teha tahad?" : "What is your main use case?"}
          </h3>
          <p className="mb-4 text-sm text-[color:var(--muted)]">
            {isEt ? "Vali see, mis kõige paremini kirjeldab sinu peamist eesmärki." : "Pick the one that best describes your primary goal."}
          </p>
          <div className="space-y-1.5">
            {USE_CASES.map((opt) => (
              <QuizOptionButton key={opt.value} onClick={() => selectAnswer("useCase", opt.value)}>
                {opt.label[isEt ? "et" : "en"]}
              </QuizOptionButton>
            ))}
          </div>
        </>
      )}

      {currentStep === "budget" && (
        <>
          <h3 className="font-display text-xl font-semibold mb-1">
            {isEt ? "Milline on sinu eelarve?" : "What is your budget range?"}
          </h3>
          <p className="mb-4 text-sm text-[color:var(--muted)]">
            {isEt ? "See aitab soovitada õige riistvaraklassi." : "This helps us recommend the right hardware tier."}
          </p>
          <div className="space-y-1.5">
            {BUDGETS.map((opt) => (
              <QuizOptionButton key={opt.value} onClick={() => selectAnswer("budget", opt.value)}>
                {opt.label[isEt ? "et" : "en"]}
              </QuizOptionButton>
            ))}
          </div>
        </>
      )}

      {currentStep === "platform" && (
        <>
          <h3 className="font-display text-xl font-semibold mb-1">
            {isEt ? "Eelistatud platvorm?" : "Preferred platform?"}
          </h3>
          <p className="mb-4 text-sm text-[color:var(--muted)]">
            {isEt ? "Kas soovid PC-d või Maci?" : "Do you want a PC or a Mac?"}
          </p>
          <div className="space-y-1.5">
            {PLATFORMS.map((opt) => (
              <QuizOptionButton key={opt.value} onClick={() => selectAnswer("platform", opt.value)}>
                {opt.label[isEt ? "et" : "en"]}
              </QuizOptionButton>
            ))}
          </div>
        </>
      )}

      {currentStep === "model-target" && (
        <>
          <h3 className="font-display text-xl font-semibold mb-1">
            {isEt ? "Milliseid mudeleid soovid käitada?" : "Which model sizes do you want to run?"}
          </h3>
          <p className="mb-4 text-sm text-[color:var(--muted)]">
            {isEt
              ? "Suuremad mudelid vajavad rohkem VRAM-i ja RAM-i. 70B+ sõltub tugevalt kvantimisest, kontekstipikkusest ja runtime'ist."
              : "Larger models need more VRAM and RAM. 70B+ depends heavily on quantization, context length, and runtime."}
          </p>
          <div className="space-y-1.5">
            {MODEL_TARGETS.map((opt) => (
              <QuizOptionButton key={opt.value} onClick={() => selectAnswer("modelTarget", opt.value)}>
                {opt.label[isEt ? "et" : "en"]}
              </QuizOptionButton>
            ))}
          </div>
        </>
      )}

      {currentStep === "noise" && (
        <>
          <h3 className="font-display text-xl font-semibold mb-1">
            {isEt ? "Müra ja suuruse eelistus?" : "Noise and size preference?"}
          </h3>
          <p className="mb-4 text-sm text-[color:var(--muted)]">
            {isEt ? "See mõjutab korpuse ja jahutuse valikut." : "This affects case and cooling selection."}
          </p>
          <div className="space-y-1.5">
            {NOISE_OPTIONS.map((opt) => (
              <QuizOptionButton key={opt.value} onClick={() => selectAnswer("noise", opt.value)}>
                {opt.label[isEt ? "et" : "en"]}
              </QuizOptionButton>
            ))}
          </div>
        </>
      )}

      {currentStep === "result" && (
        <div>
          <QuizResultHeader
            label={isEt ? "Sinu soovitused" : "Your recommendations"}
            onReset={reset}
            resetLabel={isEt ? "Alusta uuesti" : "Start over"}
          />

          <div className="space-y-4">
            {recommendations.map((rec) => (
              <QuizResultCard key={rec.key}>
                <p className="label-pill inline-block mb-3">{rec.tag[isEt ? "et" : "en"]}</p>
                <h3 className="font-display text-xl font-semibold">{rec.name[isEt ? "et" : "en"]}</h3>
                <p className="mt-2 text-sm text-[color:var(--muted)]">{rec.description[isEt ? "et" : "en"]}</p>

                {rec.profileKey && (
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      href={`/profiles/${rec.profileKey}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5"
                    >
                      {isEt ? "Vaata komplekte" : "See builds"} →
                    </Link>
                    <Link
                      href={catalogHrefForRecommendation(rec, answers)}
                      className="btn-secondary inline-flex items-center gap-1.5 text-sm"
                    >
                      {isEt ? "Ava filtriga kataloog" : "Open filtered catalog"} →
                    </Link>
                  </div>
                )}
              </QuizResultCard>
            ))}
          </div>
        </div>
      )}

      {currentStep !== "use-case" && currentStep !== "result" && (
        <QuizBackButton onClick={goBack} isEt={isEt} />
      )}
    </div>
  )
}
