import { setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { getPipelineState } from "@sentinel/server/modules/pipeline/get-pipeline-state";
import { PipelineLive } from "./pipeline-live";

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const initialState = await getPipelineState();

  return (
    <PageLayout>
      <PipelineLive initialState={initialState} />
    </PageLayout>
  );
}
