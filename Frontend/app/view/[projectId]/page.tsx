import ProjectViewClient from "./view-client";

export default async function ProjectViewPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;
  return <ProjectViewClient projectId={projectId} />;
}
