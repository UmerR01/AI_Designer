import ShareViewClient from "./view";

export default async function SharePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  return <ShareViewClient slug={slug} />;
}

