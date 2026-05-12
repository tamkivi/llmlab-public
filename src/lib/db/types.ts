import "server-only";

// ── Product catalog types ──

export type GpuRecord = {
  id: number;
  name: string;
  brand: string;
  vram_gb: number;
  architecture: string;
  tdp_watts: number;
  ai_score: number;
  price_eur: number;
  vram_type: string;
  memory_bus_bits: number;
  memory_bandwidth_gbps: number;
  cuda_cores: number;
  stream_processors: number;
  tensor_cores: number;
  rt_cores: number;
  base_clock_mhz: number;
  boost_clock_mhz: number;
  recommended_psu_w: number;
  pcie_generation: string;
  slot_width: number;
  length_mm: number;
  power_connectors: string;
  nvlink_support: number;
  fp16_tensor_tflops: number;
  fp32_tflops: number;
  inference_notes: string;
  generation: string;
  source_refs: string;
  mpn: string;
  release_year: number;
  release_quarter: string;
  display_power_w: number;
  connector_standard: string;
  minimum_psu_w: number;
  dual_gpu_capable: number;
};

export type CpuRecord = {
  id: number;
  name: string;
  brand: string;
  cores: number;
  threads: number;
  base_clock_ghz: number;
  boost_clock_ghz: number;
  socket: string;
  tdp_watts: number;
  ai_score: number;
  price_eur: number;
  cache_l3_mb: number;
  integrated_graphics: string;
  memory_type_support: string;
  max_memory_gb: number;
  pcie_generation: string;
  unlocked: number;
  cooler_included: number;
  source_refs: string;
  mpn: string;
  release_year: number;
  release_quarter: string;
  platform_generation: string;
  memory_channels: number;
  ecc_support: number;
};

export type RamKitRecord = {
  id: number;
  name: string;
  brand: string;
  capacity_gb: number;
  modules: string;
  ddr_gen: string;
  speed_mt_s: number;
  cas_latency: string;
  profile_support: string;
  price_eur: number;
  source_refs: string;
  voltage: number;
  ecc: number;
  registered: number;
  recommended_platform: string;
};

export type PowerSupplyRecord = {
  id: number;
  name: string;
  brand: string;
  wattage: number;
  efficiency_rating: string;
  atx_standard: string;
  modularity: string;
  pcie_5_support: number;
  price_eur: number;
  source_refs: string;
  psu_form_factor: string;
  native_12vhpwr: number;
  gpu_connector_count: number;
  warranty_years: number;
};

export type CaseRecord = {
  id: number;
  name: string;
  brand: string;
  form_factor: string;
  max_gpu_mm: number;
  radiator_support: string;
  included_fans: string;
  price_eur: number;
  source_refs: string;
  max_cpu_cooler_height_mm: number;
  max_psu_length_mm: number;
  dimensions_mm: string;
  drive_bays: string;
  airflow_notes: string;
};

export type MotherboardRecord = {
  id: number;
  name: string;
  brand: string;
  socket: string;
  chipset: string;
  memory_support: string;
  max_memory_gb: number;
  pcie_gen5_support: number;
  price_eur: number;
  source_refs: string;
  form_factor: string;
  memory_slots: number;
  pcie_x16_slots: number;
  pcie_generation: string;
  m2_slots: number;
  sata_ports: number;
  ethernet: string;
  wifi: string;
  usb4_support: number;
  thunderbolt_support: number;
  bios_flashback: number;
  mb_notes: string;
};

export type CompactAiSystemRecord = {
  id: number;
  name: string;
  vendor: string;
  chip: string;
  memory_gb: number;
  storage_gb: number;
  gpu_class: string;
  installed_software: string;
  best_for: string;
  price_eur: number;
  in_stock: number;
  source_refs: string;
  npu_tops: number;
  ports: string;
  upgradeability: string;
  ai_workload_notes: string;
};

export type StorageDriveRecord = {
  id: number;
  name: string;
  brand: string;
  drive_type: string;
  interface: string;
  capacity_gb: number;
  seq_read_mb_s: number;
  endurance_tbw: number;
  price_eur: number;
  source_refs: string;
  form_factor: string;
  pcie_generation: string;
  seq_write_mb_s: number;
  dram_cache: number;
  nand_type: string;
  warranty_years: number;
  interface_generation: string;
};

export type CpuCoolerRecord = {
  id: number;
  name: string;
  brand: string;
  cooler_type: string;
  radiator_or_height_mm: number;
  socket_support: string;
  max_tdp_w: number;
  noise_db: string;
  price_eur: number;
  source_refs: string;
  fan_size_mm: number;
  ram_clearance_notes: string;
};

export type MacSystemRecord = {
  id: number;
  name: string;
  chip: string;
  cpu_cores: number;
  gpu_cores: number;
  unified_memory_gb: number;
  storage_gb: number;
  ports: string;
  thunderbolt_version: string;
  usb4_supported: number;
  macos_min_version: string;
  estimated_price_eur: number;
  notes: string;
  neural_engine_cores: number;
  memory_bandwidth_gbps: number;
  external_gpu_support: number;
  ai_framework_notes: string;
  local_llm_notes: string;
};

export type ExternalGpuEnclosureRecord = {
  id: number;
  name: string;
  connection_type: string;
  pcie_generation: string;
  pcie_lanes: number;
  max_gpu_length_mm: number;
  max_gpu_slots: number;
  included_psu_watts: number;
  requires_external_psu: number;
  supports_open_frame: number;
  estimated_price_eur: number;
  notes: string;
  thunderbolt_version: string;
  macos_support_notes: string;
  windows_support_notes: string;
  nvidia_support_notes: string;
  amd_support_notes: string;
};

export type MacEgpuBuildRecord = {
  id: number;
  name: string;
  mac_system_id: number;
  egpu_enclosure_id: number;
  gpu_id: number;
  target_workloads: string;
  unsupported_workloads: string;
  risk_level: string;
  buyer_warning: string;
  notes: string;
};

export type EstonianPriceCheckRecord = {
  id: number;
  category: string;
  item_id: number;
  item_name: string;
  base_price_eur: number;
  market_avg_eur: number;
  assembly_markup_pct: number;
  final_price_eur: number;
  sample_count: number;
  sources: string;
  checked_at: string;
};

export type ProfileBuildRecord = {
  id: number;
  profile_key: string;
  profile_label: string;
  build_name: string;
  target_model: string;
  ram_gb: number;
  storage_gb: number;
  estimated_price_eur: number;
  best_for: string;
  estimated_tokens_per_sec: string;
  estimated_system_power_w: number;
  recommended_psu_w: number;
  cooling_profile: string;
  notes: string;
  source_refs: string;
  cpu_id: number;
  gpu_id: number;
  ram_kit_id: number | null;
  storage_drive_id: number | null;
  motherboard_id: number | null;
  power_supply_id: number | null;
  case_id: number | null;
  cpu_cooler_id: number | null;
  compatibility_notes: string;
};

export type ProfileBuildWithNamesRecord = ProfileBuildRecord & {
  cpu_name: string;
  gpu_name: string;
  gpu_vram_gb: number;
  gpu_architecture: string;
};

// ── Auth types ──

export type UserRole = "ADMIN" | "DEV" | "USER";

export type PublicUser = {
  id: number;
  email: string;
  role: UserRole;
  createdAt: string;
};

export type AccountSummary = {
  total: number;
  admins: number;
  devs: number;
  users: number;
};

// ── Order types ──

export type OrderStatus = "PENDING" | "CHECKOUT_CREATED" | "PAID" | "CANCELED" | "FAILED";

export type OrderItemType =
  | "PROFILE_BUILD"
  | "GPU"
  | "CPU"
  | "RAM_KIT"
  | "POWER_SUPPLY"
  | "CASE"
  | "MOTHERBOARD"
  | "COMPACT_AI_SYSTEM"
  | "STORAGE_DRIVE"
  | "CPU_COOLER";

export type OrderRecord = {
  id: number;
  user_id: number;
  profile_build_id: number;
  order_item_type: OrderItemType;
  order_item_id: number;
  build_name: string;
  amount_eur_cents: number;
  currency: string;
  status: OrderStatus;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  customer_email_sent_at: string | null;
  admin_email_sent_at: string | null;
  customer_email_send_attempted_at: string | null;
  admin_email_send_attempted_at: string | null;
  customer_email_last_error: string;
  admin_email_last_error: string;
  created_at: string;
  updated_at: string;
};

export type UserOrderListItem = {
  id: number;
  build_name: string;
  amount_eur_cents: number;
  currency: string;
  status: OrderStatus;
  stripe_checkout_session_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminOrderListItem = {
  id: number;
  user_id: number;
  user_email: string;
  profile_build_id: number;
  order_item_type: string;
  order_item_id: number;
  build_name: string;
  amount_eur_cents: number;
  currency: string;
  status: OrderStatus;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  customer_email_sent_at: string | null;
  admin_email_sent_at: string | null;
  customer_email_send_attempted_at: string | null;
  admin_email_send_attempted_at: string | null;
  customer_email_last_error: string;
  admin_email_last_error: string;
  created_at: string;
  updated_at: string;
};

export type AdminQuoteRequestListItem = {
  id: number;
  customer_email: string;
  customer_name: string;
  product_type: string;
  product_id: number;
  product_name: string;
  status: QuoteRequestStatus;
  operator_note: string;
  contacted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PaidOrderEmailPayload = {
  orderId: number;
  customerEmail: string;
  buildName: string;
  amountEurCents: number;
  createdAt: string;
};

export type OrderPriceSnapshotRecord = {
  id: number;
  order_id: number;
  slot_key: string;
  order_item_type: string;
  item_id: number;
  item_name: string;
  unit_price_eur: number;
  price_source: string;
  created_at: string;
};

export type QuoteRequestStatus = "NEW" | "CONTACTED" | "WAITING_CUSTOMER" | "QUOTED" | "CLOSED" | "SPAM";

export type QuoteRequestRecord = {
  id: number;
  customer_email: string;
  customer_name: string;
  product_type: string;
  product_id: number;
  product_name: string;
  message: string;
  status: QuoteRequestStatus;
  operator_note: string;
  contacted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PricingRunRecord = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  total_items: number;
  updated_items: number;
  failed_items: number;
  notes: string;
};

export type PricingRunFailureRecord = {
  id: number;
  run_id: number;
  category: string;
  item_id: number;
  item_name: string;
  source: string;
  error_message: string;
  created_at: string;
};

export type PriceHistoryRecord = {
  id: number;
  category: string;
  item_id: number;
  price_eur: number;
  source: string;
  recorded_at: string;
  recorded_date: string | null;
};
