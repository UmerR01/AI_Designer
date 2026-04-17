import InviteAcceptClient from "./view";

export default async function InviteAcceptPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return <InviteAcceptClient token={token} />;
}

