import SignContractClient from "./SignContractClient";

type Params = Promise<{ token: string }>;

export default async function SignContractPage({
  params,
}: {
  params: Params;
}) {
  const { token } = await params;
  return <SignContractClient token={token} />;
}
