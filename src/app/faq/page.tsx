import Link from "next/link";
import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import { ProfileRecommendationQuiz } from "@/components/profile-recommendation-quiz";
import { getRequestLanguage } from "@/lib/server/lang";
import { JsonLd, absoluteUrl, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "FAQ",
  description: "Answers about local AI PCs, VRAM, model sizes, ordering, NVIDIA vs AMD, Mac systems, and software for local LLMs.",
  path: "/faq",
});

export default async function FaqPage() {
  const lang = await getRequestLanguage();

  const glossary =
    lang === "et"
      ? [
          {
            term: "LLM ehk suur keelemudel",
            meaning: "Tekstimudel, mis oskab vestelda, kirjutada, kokku võtta, tõlkida ja koodi aidata. Näited on Llama, Qwen ja Mistral.",
          },
          {
            term: "Parameetrid: 7B, 13B, 70B",
            meaning: "Mudeli suuruse ligikaudne mõõt. Suurem mudel oskab tavaliselt rohkem, kuid vajab rohkem VRAM-i ja on aeglasem.",
          },
          {
            term: "Kvantiseerimine",
            meaning: "Mudeli pakkimine väiksemaks, et see mahuks GPU mällu. 4-bitine mudel kasutab vähem VRAM-i ja on koduarvutis praktilisem.",
          },
          {
            term: "Token",
            meaning: "Teksti väike osa, umbes sõna või sõna tükk. Kiirust mõõdetakse sageli tokenites sekundis.",
          },
          {
            term: "LoRA / QLoRA",
            meaning: "Meetod mudeli peenhäälestamiseks ilma kogu mudelit nullist treenimata. Vajab rohkem RAM-i, jahutust ja stabiilsust kui lihtsalt vestlemine.",
          },
          {
            term: "CUDA / ROCm",
            meaning: "GPU tarkvaraplatvormid. NVIDIA kasutab CUDA-t, AMD kasutab ROCm-i. CUDA on praegu lihtsam ja laiemalt toetatud.",
          },
        ]
      : [
          {
            term: "LLM / large language model",
            meaning: "A text model that can chat, write, summarize, translate, and help with code. Examples include Llama, Qwen, and Mistral.",
          },
          {
            term: "Parameters: 7B, 13B, 70B",
            meaning: "A rough measure of model size. Larger models are usually more capable, but need more VRAM and run slower.",
          },
          {
            term: "Quantization",
            meaning: "Compressing a model so it fits in GPU memory. A 4-bit model uses much less VRAM and is more practical on a local PC.",
          },
          {
            term: "Token",
            meaning: "A small piece of text, roughly a word or part of a word. Speed is often measured in tokens per second.",
          },
          {
            term: "LoRA / QLoRA",
            meaning: "A way to fine-tune a model without retraining the whole thing. It needs more RAM, cooling, and stability than just chatting.",
          },
          {
            term: "CUDA / ROCm",
            meaning: "GPU software platforms. NVIDIA uses CUDA, AMD uses ROCm. CUDA is currently easier and more widely supported.",
          },
        ];

  const buyingBasics =
    lang === "et"
      ? [
          "Alusta kasutusviisist, mitte komponendist: vestlus, kodeerimine, pildiloome, peenhäälestus, mängimine või meeskonna kasutus.",
          "VRAM määrab, kui suurt mudelit saad mugavalt käitada. Süsteemi RAM aitab siis, kui tööriistu, andmeid või osalist mudeli mahalaadimist on rohkem.",
          "Kui tahad lihtsat kogemust, eelista NVIDIA + CUDA teed. AMD võib anda rohkem VRAM-i euro kohta, kuid nõuab rohkem valmisolekut seadistada.",
          "Ära osta ainult GPU nime järgi. Korpus, jahutus, toiteplokk ja emaplaat peavad pikema koormuse all samuti sobima.",
          "Kui sa ei tea veel mudeli suurust, vali pigem paindlikum 16-24GB VRAM-i klass kui väga odav miinimum.",
          "Mac on hea vaikseks ja lihtsaks kohalikuks kasutuseks, kuid CUDA-põhiste töövoogude jaoks on PC tavaliselt praktilisem.",
        ]
      : [
          "Start with the use case, not the component: chat, coding, image generation, fine-tuning, gaming, or team use.",
          "VRAM decides which model size is comfortable. System RAM helps when tools, datasets, or partial model offload get larger.",
          "If you want the simplest experience, prefer the NVIDIA + CUDA path. AMD can offer more VRAM per euro, but needs more setup tolerance.",
          "Do not buy by GPU name alone. Case airflow, cooling, PSU, and motherboard choice also matter under sustained load.",
          "If you do not know your model size yet, a flexible 16-24GB VRAM class is usually safer than the absolute cheapest option.",
          "Mac is good for quiet, simple local use, but a PC is usually more practical for CUDA-based workflows.",
        ];

  const faqs =
    lang === "et"
      ? [
          {
            q: "Kui ma olen täiesti algaja, kust peaksin alustama?",
            a: "Kõige lihtsam algus on kohalik LLM profiil või macOS-il põhinev süsteem. Kui tahad lihtsalt vestelda, dokumente töödelda või kodeerimisabilist kasutada, ei ole vaja kohe multi-GPU tööjaama. Kui soovid hiljem peenhäälestada või 70B+ mudeleid tõsisemalt käitada, tasub valida võimsam ja paindlikum komplekt.",
          },
          {
            q: "Mis on VRAM ja miks see tehisaru jaoks oluline on?",
            a: "VRAM on sinu GPU mälu. Kiireks mudeli käitamiseks peab suurem osa mudeli kaaludest VRAM-i mahtuma. Lihtne reegel: 4-bitine kvantiseeritud mudel vajab umbes 0,5 GB mälu miljardi parameetri kohta. Näiteks 7B mudel vajab umbes 4 GB, 13B mudel umbes 8 GB ja 70B mudel umbes 40 GB. Kui VRAM saab otsa, liiguvad kihid süsteemi RAM-i, mis on tavaliselt 5–10 korda aeglasem.",
          },
          {
            q: "Kui palju VRAM-i peaksin valima?",
            a: "7B mudeliteks piisab sageli 8-12GB VRAM-ist. 13B mudeliteks on 12-16GB mugavam. 20B-34B mudeliteks on 16-24GB hea klass. 70B mudelite jaoks tasub vaadata 24GB+, mitme GPU või tööjaama lahendusi. Kui tahad arvutit kauem kasutada, on VRAM-i varu tavaliselt olulisem kui väike CPU võit.",
          },
          {
            q: "Mis vahe on kohaliku mudeli käitamisel ja peenhäälestusel?",
            a: "Mudeli käitamine tähendab, et kasutad valmis mudelit vestluseks, koodi kirjutamiseks või dokumentidega töötamiseks. Peenhäälestus tähendab, et õpetad mudelit oma andmete või stiili järgi paremini käituma. Peenhäälestus vajab rohkem RAM-i, stabiilsemat jahutust ja tihti rohkem salvestusruumi.",
          },
          {
            q: "Milline profiil sobib mulle?",
            a: "Kohalik LLM: igapäevane 7B–70B mudelite kasutus ja võimalikult palju VRAM-i raha eest. LLM-i peenhäälestus: LoRA adapterite ja kohandatud treeningute jaoks, vajab rohkem RAM-i ja stabiilset jahutust. Tehisaru + mängimine: tehisaru arendus päeval, mängimine õhtul. Kui pole kindel, alusta kohaliku LLM-i profiilist.",
          },
          {
            q: "Kuidas tellimine toimib?",
            a: "Kui otsekassa on saadaval, maksad näidatud tellimuse hinna Stripe'i kaudu. Seejärel kontrollime valitud komplekti komponentide saadavust ja hinda Eesti turul, kinnitame võimalikud asendused enne jätkamist ning paneme süsteemi kokku koos kohaliku mudelitarkvara seadistusega. Pakkumispõhised süsteemid vaadatakse enne makset käsitsi üle.",
          },
          {
            q: "Kas kontot on vaja?",
            a: "Sirvimiseks mitte. Komplektid ja kataloog on kõigile avalikud. Kontot on vaja ainult eeltellimuse tegemiseks.",
          },
          {
            q: "NVIDIA vs AMD — kumba valida tehisaru jaoks?",
            a: "NVIDIA on kindlam valik: CUDA on valdkonna standard ja enamik tehisaru tarkvara töötab sellega probleemideta. AMD kaardid pakuvad sageli sama raha eest rohkem VRAM-i, kuid ROCm-i tugi on vähem küps ja mõned tööriistad vajavad lisaseadistust. Kui tahad, et kõik lihtsalt töötaks, vali NVIDIA. Kui oled valmis veidi seadistama ja soovid rohkem VRAM-i euro kohta, tasub AMD-d kaaluda.",
          },
          {
            q: "Kas tavaline mänguriarvuti sobib tehisaru jaoks?",
            a: "Osaliselt. Mänguriarvutid on optimeeritud kõrge kaadrisageduse jaoks, kuid tehisaru vajab suurte mudelite jaoks palju VRAM-i. Enamik mängurikaarte on 8–12 GB VRAM-iga, mis piirab käitatavaid mudelisuurusi. Siinsed tehisarule mõeldud komplektid valivad kaardid VRAM-i ja mudelite käitamise jõudluse, mitte mängutestide järgi.",
          },
          {
            q: "Kui palju kiirem on kohalik AI võrreldes ChatGPT-ga?",
            a: "See sõltub riistvarast, mudelist ja seadistusest. Hea GPU-ga (nt RTX 4090) võib 7B mudelitega jõuda 50–100 tokenini sekundis, kuid suuremad mudelid on aeglasemad. Peamine eelis ei ole ainult kiirus, vaid privaatsus, kulude kontroll ja võrguühenduseta kasutamine: kohalikud jooksutused ei tekita eraldi API päringutasu.",
          },
          {
            q: "Millist tarkvara on vaja alustamiseks?",
            a: "Ollama on lihtsaim alguspunkt: paigalda see, laadi mudel käsuga 'ollama pull llama3' alla ja saadki vestlema hakata. Open WebUI lisab sellele ChatGPT-laadse veebiliidese. LLMLab.ee komplektide puhul on plaanitud töövoog vajalik tarkvara eelnevalt seadistada, et alustamine oleks lihtsam.",
          },
          {
            q: "Mida peaksin enne ostu kindlasti teadma?",
            a: "Kõige tähtsam on teada, mida tahad teha: lihtsalt mudeleid kasutada, peenhäälestada, pilte luua, mängida või jagada masinat mitme inimesega. Teiseks tasub mõelda mürale, elektrikulule, ruumile ja uuendamise võimalusele. Odavaim komplekt võib olla hea algus, kuid liiga väike VRAM piirab kiiresti, milliseid mudeleid saad kasutada.",
          },
        ]
      : [
          {
            q: "If I am completely new, where should I start?",
            a: "The easiest starting point is the Local LLM profile or a macOS-based system. If you only want chat, document work, or a coding assistant, you do not need a multi-GPU workstation. If you plan to fine-tune later or run 70B+ models seriously, choose a more powerful and flexible system.",
          },
          {
            q: "What is VRAM and why does it matter for AI?",
            a: "VRAM is memory on your GPU. Most of a model's weights need to fit in VRAM for fast inference. A rough rule: a 4-bit quantized model needs about 0.5 GB per billion parameters — so a 7B model needs ~4 GB, a 13B needs ~8 GB, and a 70B model needs ~40 GB. When VRAM runs out, layers spill to CPU RAM, which is 5–10× slower.",
          },
          {
            q: "How much VRAM should I choose?",
            a: "For 7B models, 8-12GB VRAM is often enough. For 13B models, 12-16GB is more comfortable. For 20B-34B models, 16-24GB is a good class. For 70B models, look at 24GB+, multi-GPU, or workstation systems. If you want the machine to last, extra VRAM is usually more valuable than a small CPU upgrade.",
          },
          {
            q: "What is the difference between running a model and fine-tuning?",
            a: "Running a model means using an existing model for chat, coding, writing, or document work. Fine-tuning means adapting a model to your data or style. Fine-tuning needs more RAM, more stable cooling, and often more storage than basic local chat.",
          },
          {
            q: "Which build profile is right for me?",
            a: "Local LLM Inference: daily 7B–70B model use, best VRAM per dollar. LLM Fine-Tune Starter: LoRA adapters and custom training runs, needs more system RAM and stable long-session cooling. Hybrid AI + Gaming: AI development during the day, gaming at night. When in doubt, start with Local LLM Inference.",
          },
          {
            q: "How does ordering work?",
            a: "When direct checkout is available, you pay the listed order price through Stripe. We then check availability and pricing for compatible parts from Estonian retailers, confirm any practical substitutions before continuing, and assemble the system with local model software setup. Quote-only systems are reviewed manually before payment.",
          },
          {
            q: "Do I need an account to browse?",
            a: "No. Browsing builds and the catalog is fully public. You only need an account to place a paid order.",
          },
          {
            q: "NVIDIA vs AMD — which is better for AI?",
            a: "NVIDIA is the safer choice: CUDA is the industry standard and almost all AI software works with it out of the box. AMD cards often offer more VRAM for the money, but ROCm support is less mature and some tools need extra setup. If you want everything to just work, pick NVIDIA. If you're comfortable tinkering and want more VRAM per euro, AMD is worth considering.",
          },
          {
            q: "Can I use a regular gaming PC for local AI?",
            a: "Partly. Gaming PCs are tuned for high frame rates, but AI needs a lot of VRAM to hold large models. Most gaming cards top out at 8–12 GB VRAM, which limits which model sizes you can run. The AI-specific builds here pick cards based on maximum VRAM and AI throughput, not gaming benchmark scores.",
          },
          {
            q: "How fast is local AI compared to ChatGPT?",
            a: "It depends on your hardware, model, and setup. A good GPU (e.g. RTX 4090) can hit 50–100 tokens per second on 7B models, while larger models are slower. The main advantage is not just raw speed; local runs can improve privacy, cost control, and offline access because they do not incur per-query API fees.",
          },
          {
            q: "What software do I need to get started?",
            a: "Ollama is the easiest starting point: install it, pull a model with 'ollama pull llama3', and start chatting. Open WebUI gives you a ChatGPT-style web interface on top. For LLMLab.ee builds, the planned workflow is to set up the relevant software before handover so getting started is simpler.",
          },
          {
            q: "What should I know before buying?",
            a: "The most important thing is the workload: local chat, fine-tuning, image generation, gaming, or sharing the machine with a team. Also think about noise, power use, physical size, and upgrade path. The cheapest build can be a good start, but too little VRAM quickly limits which models you can use.",
          },
        ];

  return (
    <main className="min-h-screen px-6 py-16 md:px-12">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: {
              "@type": "Answer",
              text: item.a,
            },
          })),
          url: absoluteUrl("/faq"),
        }}
      />
      <section className="mx-auto max-w-6xl">
        <Masthead lang={lang} />
        <header className="mb-14 stagger-in" style={{ animationDelay: "80ms" }}>
          <PageNav links={[{ href: "/", label: lang === "et" ? "Avaleht" : "Home" }, { href: "/about", label: lang === "et" ? "Meist" : "About" }]} lang={lang} />
          <h1 className="font-display mt-6 text-4xl font-semibold tracking-tight md:text-6xl">
            {lang === "et" ? "Korduma kippuvad küsimused" : "Frequently Asked Questions"}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-[color:var(--muted)]">
            {lang === "et"
              ? "Kõik, mida pead kohalike tehisaru arvutikomplektide kohta teadma — algajale arusaadavalt."
              : "Everything you need to know about local AI builds — written for newcomers."}
          </p>
        </header>

        <div className="space-y-6 stagger-in" style={{ animationDelay: "200ms" }}>
          {/* Featured section */}
          <section
            className="wireframe-panel border-2 border-[color:var(--accent)] p-8 md:p-10"
            style={{
              boxShadow:
                "0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent), 0 0 32px color-mix(in srgb, var(--accent) 18%, transparent)",
            }}
          >
            <p className="label-pill inline-block mb-4">
              {lang === "et" ? "Miks see oluline on" : "Why this matters"}
            </p>
            <h2 className="font-display text-3xl font-semibold">
              {lang === "et" ? "Miks tehisaruks valmis arvutikomplektid?" : "Why AI-ready builds?"}
            </h2>
            <div className="mt-5 max-w-3xl space-y-4 text-[color:var(--muted)]">
              {lang === "et" ? (
                <>
                  <p>
                    Kohaliku tehisaru kasutamisel ei lahku sinu andmed sinu arvutist: pole API võtmeid, kasutustasusid
                    ega päringupiiranguid. Arendajatele ja teadlastele, kes kasutavad mudeleid regulaarselt, tasub
                    riistvarakulu end API kasutamisega võrreldes sageli kuudega ära.
                  </p>
                  <p>
                    Konks on selles, et kiireks käitamiseks peavad mudeli kaalud VRAM-i mahtuma. Vale riistvaraga
                    arvuti on igapäevaseks kasutuseks kas liiga aeglane või ei suuda suuremaid mudeleid üldse käivitada.
                    Siinsed komplektid on koostatud nii, et VRAM, süsteemimälu, salvestusruum ja jahutus vastaksid sinu
                    tegelikule töökoormusele.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Running AI locally can keep model prompts and files on your own machine instead of sending them to
                    a third-party API. For developers and researchers who run models regularly, local hardware can make
                    cost control easier than API-only usage at scale. You also get low-latency inference and the option
                    to work offline when your model and tools support it.
                  </p>
                  <p>
                    The catch is that model weights need to fit in VRAM for fast inference. A machine built for gaming
                    will often bottleneck badly on AI workloads. The builds here are chosen so that VRAM, system memory,
                    storage speed, and cooling are matched to your intended workload — not just the cheapest part that
                    fits.
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="wireframe-panel p-8 md:p-10">
            <p className="label-pill inline-block mb-4">
              {lang === "et" ? "Sõnastik algajale" : "Beginner glossary"}
            </p>
            <h2 className="font-display text-3xl font-semibold">
              {lang === "et" ? "Põhimõisted lihtsas keeles" : "Core terms in plain language"}
            </h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {glossary.map((item) => (
                <article key={item.term} className="inner-card rounded-lg border border-[color:var(--panel-border)] p-5">
                  <h3 className="font-display text-lg font-semibold">{item.term}</h3>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{item.meaning}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="wireframe-panel p-8 md:p-10">
            <p className="label-pill inline-block mb-4">
              {lang === "et" ? "Enne ostu" : "Before you buy"}
            </p>
            <h2 className="font-display text-3xl font-semibold">
              {lang === "et" ? "Mida tasub otsuse tegemisel teada" : "What to know before choosing"}
            </h2>
            <ul className="arrow-list mt-6 space-y-3 text-sm leading-6 text-[color:var(--muted)]">
              {buyingBasics.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          {/* Regular FAQ items */}
          {faqs.map((item, index) => (
            <section
              key={item.q}
              className="wireframe-panel p-8 stagger-in"
              style={{ animationDelay: `${300 + index * 80}ms` }}
            >
              <div className="faq-item">
                <h2 className="font-display text-2xl font-semibold">{item.q}</h2>
                <p className="mt-4 text-[color:var(--muted)]">{item.a}</p>
              </div>
            </section>
          ))}

          {/* Which One Should I Pick? */}
          <section
            id="which-one"
            className="wireframe-panel border-2 border-[color:var(--accent)] p-8 md:p-10 stagger-in"
            style={{
              animationDelay: `${300 + faqs.length * 80}ms`,
              scrollMarginTop: "5rem",
              boxShadow:
                "0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent), 0 0 32px color-mix(in srgb, var(--accent) 18%, transparent)",
            }}
          >
            <p className="label-pill inline-block mb-4">
              {lang === "et" ? "Abi valimisel" : "Decision guide"}
            </p>
            <h2 className="font-display text-3xl font-semibold mb-5">
              {lang === "et" ? "Milline profiil sobib mulle?" : "Which one should I pick?"}
            </h2>
            <ProfileRecommendationQuiz lang={lang} />
          </section>
        </div>

        <div className="mt-12 stagger-in" style={{ animationDelay: "700ms" }}>
          <p className="text-sm text-[color:var(--muted)]">
            {lang === "et" ? "Rohkem küsimusi? " : "More questions? "}
            <Link href="/about" className="text-[color:var(--accent)] underline underline-offset-2">
              {lang === "et" ? "Loe, kuidas see töötab." : "Read about how it works."}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
