import { useQuery } from "@apollo/client";
import { GET_CONTRACT_LEDGER } from "../graphql/queries";
import { CONTRACT_ADDRESS } from "../config";

export interface LedgerState {
  contract_address: string;
  ledger_state: string;
  created_at: string;
  updated_at: string;
}

export interface ContractStateResult {
  data: LedgerState | null;
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

export function useContractState(
  contractAddress: string = CONTRACT_ADDRESS
): ContractStateResult {
  const { data, loading, error, refetch } = useQuery(GET_CONTRACT_LEDGER, {
    variables: { contractAddress },
    skip: !contractAddress,
    pollInterval: 30000,
  });

  const ledger: LedgerState | null = data?.contract_state?.[0] ?? null;

  return { data: ledger, loading, error, refetch };
}
