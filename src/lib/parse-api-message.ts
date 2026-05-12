export async function parseApiMessage(response: Response): Promise<string | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await response.json().catch(() => null)) as { message?: string } | null;
    return data?.message ?? null;
  }

  const text = await response.text().catch(() => "");
  return text.trim() ? text.slice(0, 200) : null;
}
