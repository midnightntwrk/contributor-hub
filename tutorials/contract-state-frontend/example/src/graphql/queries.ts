import { gql } from "@apollo/client";

export const GET_CONTRACT_LEDGER = gql`
  query GetContractLedger($contractAddress: String!) {
    contract_state(where: { contract_address: { _eq: $contractAddress } }) {
      contract_address
      ledger_state
      created_at
      updated_at
    }
  }
`;

export const CONTRACT_ACTIONS_SUBSCRIPTION = gql`
  subscription OnContractActions($contractAddress: String!) {
    contractActions(contractAddress: $contractAddress) {
      transactionHash
      actionType
      timestamp
      ledgerDiff
    }
  }
`;
