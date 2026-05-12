interface SoftwareFeature {
  title: { en: string; et: string };
  description: { en: string; et: string };
}

const FEATURES: SoftwareFeature[] = [
  {
    title: { en: "Ollama / llama.cpp ready", et: "Ollama / llama.cpp valmis" },
    description: { en: "Download and run AI models on your own computer.", et: "Laadi alla ja käivita tehisaru mudeleid oma arvutis." },
  },
  {
    title: { en: "CUDA / ROCm configured", et: "CUDA / ROCm seadistatud" },
    description: { en: "GPU software setup is checked where applicable.", et: "GPU tarkvara seadistus kontrollitakse sobivuse korral." },
  },
  {
    title: { en: "Docker + Python environment", et: "Docker + Python keskkond" },
    description: { en: "A practical coding setup for AI tools and projects.", et: "Praktiline koodikeskkond tehisaru tööriistade ja projektide jaoks." },
  },
  {
    title: { en: "Open WebUI / local chat interface", et: "Open WebUI / kohalik vestlusliides" },
    description: { en: "Use a private chat app that runs on your computer.", et: "Kasuta privaatset vestlusäppi, mis töötab sinu arvutis." },
  },
  {
    title: { en: "Stable Diffusion setup", et: "Stable Diffusion seadistus" },
    description: { en: "Create AI images with the main tools already set up.", et: "Loo tehisaru abil pilte juba seadistatud tööriistadega." },
  },
  {
    title: { en: "Remote access setup", et: "Kaugjuurdepääsu seadistus" },
    description: { en: "Optional remote-access setup, confirmed before configuration.", et: "Soovi korral kaugjuurdepääsu seadistus, kinnitatakse enne seadistamist." },
  },
  {
    title: { en: "Driver & thermal stability testing", et: "Draiveri ja termiline testimine" },
    description: { en: "Baseline driver and thermal checks before handover.", et: "Draiveri ja temperatuuride põhikontroll enne üleandmist." },
  },
  {
    title: { en: "Model download & setup guidance", et: "Mudeli allalaadimise juhend" },
    description: { en: "Simple steps for running your first AI model.", et: "Lihtsad sammud esimese tehisaru mudeli käivitamiseks." },
  },
];

export function SoftwareReadySection({ lang }: { lang: string }) {
  const isEt = lang === "et";

  return (
    <section className="software-ready-section">
      <p className="label-pill inline-block mb-5">
        {isEt ? "Tarkvara kaasa arvatud" : "Software included"}
      </p>
      <h2 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
        {isEt ? "Seadistatud kohaliku tehisaru jaoks" : "Prepared for local AI"}
      </h2>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-[color:var(--muted)]">
        {isEt
          ? "Paneme arvuti kokku, kontrollime selle üle ja seadistame vajalikud tööriistad."
          : "We assemble the computer, check it, and set up the tools you need."}
      </p>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 md:gap-6 lg:grid-cols-4">
        {FEATURES.map((feature) => (
          <div key={feature.title.en} className="product-card p-6">
            <h3 className="font-display text-base font-semibold">{feature.title[isEt ? "et" : "en"]}</h3>
            <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">{feature.description[isEt ? "et" : "en"]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
