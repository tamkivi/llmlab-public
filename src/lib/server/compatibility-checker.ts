import "server-only";
import type {
  GpuRecord,
  CpuRecord,
  RamKitRecord,
  MotherboardRecord,
  PowerSupplyRecord,
  CaseRecord,
  CpuCoolerRecord,
  StorageDriveRecord,
  MacSystemRecord,
  ExternalGpuEnclosureRecord,
} from "@/lib/db";

export type CompatibilityWarning = {
  severity: "error" | "warning";
  category: string;
  message: string;
};

type BuildComponents = {
  cpu: CpuRecord | null;
  gpu: GpuRecord | null;
  ram: RamKitRecord | null;
  motherboard: MotherboardRecord | null;
  psu: PowerSupplyRecord | null;
  case: CaseRecord | null;
  cooler: CpuCoolerRecord | null;
  storage: StorageDriveRecord | null;
};

type MacEgpuComponents = {
  mac: MacSystemRecord | null;
  enclosure: ExternalGpuEnclosureRecord | null;
  gpu: GpuRecord | null;
};

function normalizeMemoryType(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("ecc rdimm")) return "DDR5 ECC RDIMM";
  if (lower.includes("ecc")) return "DDR5 ECC";
  if (lower.includes("ddr5")) return "DDR5";
  if (lower.includes("ddr4")) return "DDR4";
  return raw;
}

function parseSockets(raw: string): string[] {
  return raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

function parseRadiatorSupport(raw: string): number[] {
  const matches = raw.match(/(\d{2,3})\s*mm/g) ?? [];
  return matches.map((m) => Number.parseInt(m, 10));
}

function parseRamModuleCount(raw: string): number {
  const match = raw.match(/(\d+)\s*x\s*\d+\s*GB/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function checkBuildCompatibility(components: BuildComponents): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  const { cpu, gpu, ram, motherboard, psu, case: pcCase, cooler, storage } = components;

  if (cpu && motherboard) {
    if (cpu.socket !== motherboard.socket) {
      warnings.push({
        severity: "error",
        category: "socket_mismatch",
        message: `CPU socket ${cpu.socket} incompatible with motherboard socket ${motherboard.socket}`,
      });
    }
  }

  if (cpu && ram) {
    const cpuMemType = normalizeMemoryType(cpu.memory_type_support);
    if (cpuMemType && ram.ddr_gen) {
      const ramType = ram.ddr_gen.toLowerCase();
      const cpuType = cpuMemType.toLowerCase();
      if (cpuType.includes("ddr5 ecc rdim") && !ramType.includes("ecc rdim")) {
        warnings.push({
          severity: "warning",
          category: "ram_type",
          message: `CPU requires ${cpuMemType}, but RAM kit is ${ram.ddr_gen}`,
        });
      } else if (cpuType.includes("ddr5") && !ramType.includes("ddr5")) {
        warnings.push({
          severity: "error",
          category: "ram_type",
          message: `CPU supports ${cpuMemType}, but RAM kit is ${ram.ddr_gen}`,
        });
      }
    }
  }

  if (motherboard && ram) {
    const mbMem = normalizeMemoryType(motherboard.memory_support);
    const ramType = ram.ddr_gen.toLowerCase();
    const mbType = mbMem.toLowerCase();
    if (mbType.includes("ddr5 ecc rdim") && !ramType.includes("ecc rdim")) {
      warnings.push({
        severity: "warning",
        category: "ram_motherboard",
        message: `Motherboard requires ${mbMem}, but RAM is ${ram.ddr_gen}`,
      });
    } else if (mbType.includes("ddr5") && !ramType.includes("ddr5")) {
      warnings.push({
        severity: "error",
        category: "ram_motherboard",
        message: `Motherboard supports ${mbMem}, but RAM is ${ram.ddr_gen}`,
      });
    }

    const moduleCount = parseRamModuleCount(ram.modules);
    if (moduleCount > 0 && motherboard.memory_slots > 0 && moduleCount > motherboard.memory_slots) {
      warnings.push({
        severity: "error",
        category: "ram_slots",
        message: `RAM kit uses ${moduleCount} modules but motherboard has ${motherboard.memory_slots} memory slots`,
      });
    }
    if (ram.capacity_gb > 0 && motherboard.max_memory_gb > 0 && ram.capacity_gb > motherboard.max_memory_gb) {
      warnings.push({
        severity: "error",
        category: "ram_capacity",
        message: `RAM kit capacity ${ram.capacity_gb}GB exceeds motherboard max memory ${motherboard.max_memory_gb}GB`,
      });
    }
  }

  if (gpu && pcCase) {
    if (gpu.length_mm > 0 && pcCase.max_gpu_mm > 0 && gpu.length_mm > pcCase.max_gpu_mm) {
      warnings.push({
        severity: "error",
        category: "gpu_case_fit",
        message: `GPU ${gpu.length_mm}mm exceeds case max GPU length ${pcCase.max_gpu_mm}mm`,
      });
    }

  }

  if (psu && gpu && cpu) {
    const estimatedPower = gpu.tdp_watts + cpu.tdp_watts + 150;
    if (gpu.recommended_psu_w > 0 && psu.wattage < gpu.recommended_psu_w) {
      warnings.push({
        severity: "error",
        category: "gpu_psu_requirement",
        message: `PSU ${psu.wattage}W is below GPU recommended PSU ${gpu.recommended_psu_w}W`,
      });
    }
    if (psu.wattage < estimatedPower) {
      warnings.push({
        severity: "warning",
        category: "psu_underpowered",
        message: `PSU ${psu.wattage}W may be insufficient for estimated system draw ~${estimatedPower}W (GPU ${gpu.tdp_watts}W + CPU ${cpu.tdp_watts}W + 150W overhead)`,
      });
    }
    if (gpu.power_connectors && gpu.power_connectors.includes("12V") && psu.native_12vhpwr === 0) {
      warnings.push({
        severity: "warning",
        category: "psu_connector",
        message: `GPU requires ${gpu.power_connectors} but PSU lacks native 12VHPWR/12V-2x6 connector (adapter may be needed)`,
      });
    }
    if (gpu.power_connectors.includes("8-pin") && psu.gpu_connector_count === 0) {
      warnings.push({
        severity: "error",
        category: "psu_connector",
        message: `GPU requires ${gpu.power_connectors} but PSU lists no GPU power connectors`,
      });
    }
  }

  if (cooler && cpu) {
    const supportedSockets = parseSockets(cooler.socket_support);
    if (supportedSockets.length > 0 && !supportedSockets.includes(cpu.socket)) {
      warnings.push({
        severity: "error",
        category: "cooler_socket",
        message: `Cooler supports [${cooler.socket_support}] but CPU socket is ${cpu.socket}`,
      });
    }
  }

  if (cooler && pcCase) {
    if (cooler.cooler_type === "Air" && cooler.radiator_or_height_mm > 0 && pcCase.max_cpu_cooler_height_mm > 0) {
      if (cooler.radiator_or_height_mm > pcCase.max_cpu_cooler_height_mm) {
        warnings.push({
          severity: "error",
          category: "cooler_height",
          message: `Cooler height ${cooler.radiator_or_height_mm}mm exceeds case max cooler height ${pcCase.max_cpu_cooler_height_mm}mm`,
        });
      }
    }
    if (cooler.cooler_type === "AIO" && cooler.radiator_or_height_mm > 0) {
      const caseRadiators = parseRadiatorSupport(pcCase.radiator_support);
      const coolerRad = cooler.radiator_or_height_mm;
      const fits = caseRadiators.some((r) => r >= coolerRad);
      if (caseRadiators.length > 0 && !fits) {
        warnings.push({
          severity: "warning",
          category: "radiator_support",
          message: `AIO radiator ${coolerRad}mm may not fit case (supports: ${pcCase.radiator_support})`,
        });
      }
    }
  }

  if (motherboard && pcCase) {
    const mbFF = motherboard.form_factor.toLowerCase();
    const caseFF = pcCase.form_factor.toLowerCase();
    if (mbFF && caseFF) {
      const atxInEatx = mbFF === "atx" && (caseFF.includes("e-atx") || caseFF.includes("ssi"));
      const matxInAtx = mbFF === "micro-atx" && (caseFF.includes("atx") || caseFF.includes("e-atx"));
      const itxInAny = mbFF === "mini-itx";
      const exactMatch = mbFF === caseFF;
      if (!exactMatch && !atxInEatx && !matxInAtx && !itxInAny) {
        if (mbFF === "e-atx" && caseFF === "atx") {
          warnings.push({
            severity: "warning",
            category: "form_factor",
            message: `E-ATX motherboard may not fit in ATX case`,
          });
        }
      }
    }
  }

  if (storage && motherboard) {
    if (storage.interface.includes("PCIe") && motherboard.m2_slots === 0) {
      warnings.push({
        severity: "warning",
        category: "storage_interface",
        message: `NVMe drive requires M.2 slot but motherboard has 0 M.2 slots listed`,
      });
    }
  }

  return warnings;
}

export function checkMacEgpuBuildCompatibility(components: MacEgpuComponents): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  const { mac, enclosure, gpu } = components;

  if (!mac) {
    warnings.push({ severity: "error", category: "missing_mac", message: "Mac system is missing" });
  }
  if (!enclosure) {
    warnings.push({ severity: "error", category: "missing_enclosure", message: "External GPU enclosure is missing" });
  }
  if (!gpu) {
    warnings.push({ severity: "error", category: "missing_gpu", message: "GPU is missing" });
  }
  if (!enclosure || !gpu) return warnings;

  if (gpu.length_mm > 0 && enclosure.max_gpu_length_mm > 0 && gpu.length_mm > enclosure.max_gpu_length_mm) {
    warnings.push({
      severity: "error",
      category: "egpu_length",
      message: `GPU ${gpu.length_mm}mm exceeds enclosure max GPU length ${enclosure.max_gpu_length_mm}mm`,
    });
  }

  if (!enclosure.supports_open_frame && gpu.slot_width > 0 && enclosure.max_gpu_slots > 0 && gpu.slot_width > enclosure.max_gpu_slots) {
    warnings.push({
      severity: "error",
      category: "egpu_slot_width",
      message: `GPU ${gpu.slot_width}-slot width exceeds enclosure max ${enclosure.max_gpu_slots}-slot support`,
    });
  }

  if (!enclosure.requires_external_psu && enclosure.included_psu_watts > 0 && gpu.recommended_psu_w > enclosure.included_psu_watts) {
    warnings.push({
      severity: "error",
      category: "egpu_psu",
      message: `Enclosure PSU ${enclosure.included_psu_watts}W is below GPU recommended PSU ${gpu.recommended_psu_w}W`,
    });
  }

  return warnings;
}
