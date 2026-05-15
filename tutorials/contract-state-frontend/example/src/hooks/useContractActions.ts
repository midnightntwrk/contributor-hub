import { useRef, useState } from "react";
import { useSubscription } from "@apollo/client";
import { CONTRACT_ACTIONS_SUBSCRIPTION } from "../graphql/queries";
import { CONTRACT_ADDRESS } from "../config";

export interface ContractAction {
  transactionHash: string;
  actionType: string;
  timestamp: string;
  ledgerDiff: string;
}

export interface ContractActionsResult {
  actions: ContractAction[];
  latestAction: ContractAction | null;
  loading: boolean;
  error: Error | undefined;
}

export function useContractActions(
  contractAddress: string = CONTRACT_ADDRESS
): ContractActionsResult {
  const [actions, setActions] = useState<ContractAction[]>([]);
  const latestRef = useRef<ContractAction | null>(null);

  const { loading, error } = useSubscription(
    CONTRACT_ACTIONS_SUBSCRIPTION,
    {
      variables: { contractAddress },
      skip: !contractAddress,
      onData: ({ data: subscriptionData }) => {
        const action = subscriptionData?.data?.contractActions;
        if (action) {
          latestRef.current = action;
          setActions((prev) => [action, ...prev].slice(0, 100));
        }
      },
    }
  );

  return { actions, latestAction: latestRef.current, loading, error };
}
