"use client"

import { useState } from "react"
import Link from "next/link"
import { catalogHref, type CatalogFilters } from "@/lib/catalog-url"
import { QuizProgressBar, QuizOptionButton, QuizBackButton, QuizResultCard, QuizResultHeader, QuizStepCounter } from "./quiz-shared"

type Category =
  | "local-llm-inference"
  | "llm-finetune-starter"
  | "hybrid-ai-gaming"
  | "workstation-ai"
  | "macos"

interface Option {
  label: { en: string; et: string }
  next: string
}

interface Question {
  id: string
  text: { en: string; et: string }
  options: Option[]
}

const questions: Question[] = [
  {
    id: "q1",
    text: {
      en: "What do you mainly want to do?",
      et: "Mida peamiselt teha tahad?",
    },
    options: [
      {
        label: {
          en: "Run AI models for daily use — chat, coding, document Q&A",
          et: "Kasutada tehisaru mudeleid igapäevaselt — vestlus, kodeerimine, dokumendid",
        },
        next: "q2",
      },
      {
        label: {
          en: "Train or fine-tune my own models on custom data",
          et: "Treenida või peenhäälestada oma mudeleid kohandatud andmetel",
        },
        next: "llm-finetune-starter",
      },
      {
        label: {
          en: "Both AI development and gaming on one machine",
          et: "Tehisaru arendus ja mängimine samal arvutil",
        },
        next: "hybrid-ai-gaming",
      },
      {
        label: {
          en: "Run large models for research, production, or a whole team",
          et: "Käitada suuri mudeleid uurimistöö, tootmise või meeskonna jaoks",
        },
        next: "q3",
      },
      {
        label: {
          en: "Something that just works — I'm new to local AI",
          et: "Midagi, mis lihtsalt töötab — olen kohaliku tehisaruga alles algaja",
        },
        next: "macos",
      },
    ],
  },
  {
    id: "q2",
    text: {
      en: "What's your budget for this build?",
      et: "Milline on sinu eelarve?",
    },
    options: [
      {
        label: { en: "Under €1,500", et: "Alla €1 500" },
        next: "local-llm-inference",
      },
      {
        label: { en: "€1,500 – €3,500", et: "€1 500 – €3 500" },
        next: "local-llm-inference",
      },
      {
        label: {
          en: "€3,500 or more — I need maximum throughput",
          et: "€3 500 või rohkem — vajan maksimaalset läbilaskevõimet",
        },
        next: "q3",
      },
    ],
  },
  {
    id: "q3",
    text: {
      en: "How large are your workloads?",
      et: "Kui suuremahulised on sinu töökoormused?",
    },
    options: [
      {
        label: {
          en: "One researcher or developer — single GPU, up to 48–80 GB VRAM",
          et: "Üks teadlane või arendaja — üks GPU, kuni 48–80 GB VRAM",
        },
        next: "workstation-ai",
      },
      {
        label: {
          en: "Team use, 70B+ models, or 100–192 GB+ VRAM across multiple GPUs",
          et: "Meeskonna kasutus, 70B+ mudelid või 100–192 GB+ VRAM mitmel GPU-l",
        },
        next: "workstation-ai",
      },
    ],
  },
]

const CATEGORIES: Record<
  Category,
  {
    tag: { en: string; et: string }
    name: { en: string; et: string }
    description: { en: string; et: string }
    pros: { en: string[]; et: string[] }
    cons: { en: string[]; et: string[] }
    profileKey?: string
  }
> = {
  "local-llm-inference": {
    tag: { en: "Most popular", et: "Kõige populaarsem" },
    name: { en: "Local LLM Inference", et: "Kohalik LLM" },
    description: {
      en: "Best for daily AI use, coding assistants, document Q&A, and general model experimentation.",
      et: "Parim igapäevaseks tehisaru kasutuseks, kodeerimisabilistele, dokumentide küsimustele-vastustele ja mudelite katsetamiseks.",
    },
    pros: {
      en: ["Best VRAM per euro of any category", "Best for 7B/13B daily use; larger models depend on VRAM/RAM", "Works with CUDA and ROCm ecosystems"],
      et: ["Parim VRAM hinna kohta", "Parim 7B/13B igapäevatööks; suuremad mudelid sõltuvad VRAM/RAM mahust", "Töötab CUDA ja ROCm-iga"],
    },
    cons: {
      en: ["Not optimised for fine-tuning runs", "Smaller VRAM limits 70B+ models"],
      et: ["Ei ole peenhäälestuseks optimeeritud", "Väiksem VRAM piirab 70B+ mudeleid"],
    },
    profileKey: "local-llm-inference",
  },
  "llm-finetune-starter": {
    tag: { en: "For training", et: "Treenimiseks" },
    name: { en: "LLM Fine-Tune Starter", et: "LLM-i peenhäälestus" },
    description: {
      en: "For ML engineers who want to train LoRA adapters or build custom models on top of open-source bases.",
      et: "ML-inseneridele, kes soovivad LoRA adaptereid treenida või kohandatud mudeleid luua.",
    },
    pros: {
      en: ["More system RAM for long training sessions", "Cooling selected for extended workloads", "LoRA and QLoRA setup can be prepared"],
      et: ["Rohkem süsteemi RAM-i pikaks treeninguks", "Pikemateks koormusteks valitud jahutus", "LoRA ja QLoRA seadistuse saab ette valmistada"],
    },
    cons: {
      en: ["More expensive than inference-only builds", "Overkill if you only want to chat with models"],
      et: ["Kallim kui pelgalt vestlemiseks", "Liigne võimsus, kui tahad ainult mudeleid kasutada"],
    },
    profileKey: "llm-finetune-starter",
  },
  "hybrid-ai-gaming": {
    tag: { en: "Two in one", et: "Kaks-ühes" },
    name: { en: "Hybrid AI + Gaming", et: "Tehisaru + mängimine" },
    description: {
      en: "For people who want a single machine that handles both AI development and high-refresh gaming.",
      et: "Neile, kes soovivad ühe arvutiga nii tehisaru arendada kui ka mängida.",
    },
    pros: {
      en: ["High-refresh gaming + local inference", "One machine for everything", "Good price-to-performance balance"],
      et: ["Sujuv mängimine + kohalik mudelite käitamine", "Üks masin mitmeks tööks", "Hea tasakaal hinna ja jõudluse vahel"],
    },
    cons: {
      en: ["GPU is a compromise — less VRAM than a pure AI build", "Higher peak power draw"],
      et: ["GPU on kompromiss — vähem VRAM-i kui ainult tehisarule mõeldud komplektil", "Kõrgem tippvõimsus"],
    },
    profileKey: "hybrid-ai-gaming",
  },
  "workstation-ai": {
    tag: { en: "Heavy AI & Multi-GPU", et: "Rasked töökoormused ja multi-GPU" },
    name: { en: "AI Workstations & Multi-GPU Systems", et: "Tehisaru tööjaamad ja multi-GPU süsteemid" },
    description: {
      en: "For researchers, labs, teams, multi-user inference serving, or anyone exploring 70B+ model workloads.",
      et: "Teadlastele, laboritele, meeskondadele, mitme kasutajaga serveriks või 70B+ mudelite katsetamiseks.",
    },
    pros: {
      en: ["Single- or multi-GPU workstation options", "ECC memory for reliability in always-on setups", "Can run multiple concurrent sessions"],
      et: ["Ühe või mitme GPU-ga tööjaama valikud", "ECC mälu töökindluseks", "Võimeline käitama mitut seanssi korraga"],
    },
    cons: {
      en: ["Expensive — €5,000–20,000+", "Needs serious cooling and high wattage PSU"],
      et: ["Kallis (€5000–20 000+)", "Vajab tugevat jahutust ja võimsat toiteplokki"],
    },
    profileKey: "workstation-ai",
  },
  macos: {
    tag: { en: "Easiest start", et: "Lihtsaim algus" },
    name: { en: "macOS-based systems", et: "macOS-il põhinevad süsteemid" },
    description: {
      en: "For beginners, macOS users, and anyone who wants a simpler starting point for local AI.",
      et: "Algajatele, macOS-i kasutajatele ja kõigile, kes soovivad lihtsamat algust kohalikuks tehisaruks.",
    },
    pros: {
      en: ["Prepared software stack", "Unified memory can serve model workloads without a separate GPU", "Quiet, power-efficient, compact"],
      et: ["Ettevalmistatud tarkvaraseadistus", "Ühtne mälu saab mudelite töökoormusi teenindada ilma eraldi GPU-ta", "Vaikne, energiasäästlik, kompaktne"],
    },
    cons: {
      en: ["Limited to models that fit in 16–96 GB unified memory", "No CUDA; ROCm doesn't apply", "GPU is not upgradeable"],
      et: ["Piiratud mudelitega, mis mahuvad 16–96 GB-sse", "CUDA puudub, ROCm ei kehti", "Ei saa GPU-d uuendada"],
    },
    profileKey: "macos-systems",
  },
}

const QUESTIONS_BY_ID = Object.fromEntries(questions.map((q) => [q.id, q]))
const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[]

function isCategoryKey(value: string): value is Category {
  return CATEGORY_KEYS.includes(value as Category)
}

function catalogHrefForCategory(category: Category) {
  const filters: Partial<CatalogFilters> = {}

  if (category === "local-llm-inference") {
    filters.platform = "desktop"
    filters.workload = "13b"
  } else if (category === "llm-finetune-starter") {
    filters.platform = "desktop"
    filters.workload = "13b"
    filters.ram = "64"
  } else if (category === "hybrid-ai-gaming") {
    filters.platform = "desktop"
    filters.workload = "13b"
  } else if (category === "workstation-ai") {
    filters.platform = "desktop"
    filters.workload = "70b"
    filters.vram = "48"
    filters.ram = "128"
    filters.budget = "3500-plus"
  } else if (category === "macos") {
    filters.platform = "mac"
    filters.checkout = "quote"
  }

  return catalogHref({ filters })
}

export function ProfileRecommendationQuiz({ lang }: { lang: string }) {
  const isEt = lang === "et"
  const [history, setHistory] = useState<string[]>(["q1"])

  const currentId = history[history.length - 1]
  const result: Category | null = isCategoryKey(currentId) ? (currentId as Category) : null
  const currentQuestion = QUESTIONS_BY_ID[currentId] ?? null

  function choose(next: string) {
    setHistory([...history, next])
  }

  function reset() {
    setHistory(["q1"])
  }

  function back() {
    if (history.length > 1) {
      setHistory(history.slice(0, -1))
    }
  }

  const stepNumber = history.filter((id) => !isCategoryKey(id)).length
  const totalSteps = 3

  if (result) {
    const cat = CATEGORIES[result]
    return (
      <div>
        <QuizResultHeader
          label={isEt ? "Soovitus" : "Recommendation"}
          onReset={reset}
          resetLabel={isEt ? "Alusta uuesti" : "Start over"}
        />

        <QuizResultCard>
          <p className="label-pill inline-block mb-3">{cat.tag[isEt ? "et" : "en"]}</p>
          <h3 className="font-display text-2xl font-semibold">{cat.name[isEt ? "et" : "en"]}</h3>
          <p className="mt-2 text-sm text-[color:var(--muted)]">{cat.description[isEt ? "et" : "en"]}</p>

          <ul className="arrow-list mt-5 space-y-1.5 text-sm text-[color:var(--muted)]">
            {cat.pros[isEt ? "et" : "en"].map((pro) => (
              <li key={pro}>{pro}</li>
            ))}
          </ul>

          <p className="mt-5 text-sm font-semibold text-[color:var(--muted)]">
            {isEt ? "Piirangud:" : "Drawbacks:"}
          </p>
          <ul className="arrow-list mt-2 space-y-1.5 text-sm text-[color:var(--muted)]">
            {cat.cons[isEt ? "et" : "en"].map((con) => (
              <li key={con}>{con}</li>
            ))}
          </ul>

          {cat.profileKey && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={`/profiles/${cat.profileKey}`}
                className="inline-flex items-center gap-1.5 category-tag"
              >
                {isEt ? "Vaata komplekte" : "View builds"} →
              </Link>
              <Link
                href={catalogHrefForCategory(result)}
                className="btn-secondary inline-flex items-center gap-1.5 text-sm"
              >
                {isEt ? "Ava filtriga kataloog" : "Open filtered catalog"} →
              </Link>
            </div>
          )}
        </QuizResultCard>
      </div>
    )
  }

  if (!currentQuestion) return null

  return (
    <div key={currentId}>
      <QuizProgressBar total={totalSteps} progress={stepNumber} className="mb-3" barClassName="h-1" />

      <QuizStepCounter current={stepNumber} total={totalSteps} isEt={isEt} />
      <h3 className="font-display text-xl font-semibold mb-3">
        {currentQuestion.text[isEt ? "et" : "en"]}
      </h3>

      <div className="space-y-1.5">
        {currentQuestion.options.map((opt, index) => (
          <QuizOptionButton key={`${currentId}-${index}-${opt.next}`} onClick={() => choose(opt.next)} className="py-2.5">
            {opt.label[isEt ? "et" : "en"]}
          </QuizOptionButton>
        ))}
      </div>

      {history.length > 1 && (
        <QuizBackButton onClick={back} isEt={isEt} />
      )}
    </div>
  )
}
