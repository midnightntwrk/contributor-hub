import React from "react";
import { ApolloProvider } from "@apollo/client";
import { apolloClient } from "./providers/indexerProvider";
import { ContractStatePanel } from "./components/ContractStatePanel";
import { LiveActionsFeed } from "./components/LiveActionsFeed";
import "./App.css";

const App: React.FC = () => (
  <ApolloProvider client={apolloClient}>
    <div className="app">
      <h1>Midnight Contract State Viewer</h1>
      <p>
        Connected to contract:{" "}
        <code>{process.env.REACT_APP_CONTRACT_ADDRESS}</code>
      </p>
      <div className="dashboard">
        <ContractStatePanel />
        <LiveActionsFeed />
      </div>
    </div>
  </ApolloProvider>
);

export default App;
