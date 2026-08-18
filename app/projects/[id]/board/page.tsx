import { redirect } from "next/navigation";

// Default to the Analysis board when no board is specified.
export default async function BoardIndex({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}/board/analysis`);
}
