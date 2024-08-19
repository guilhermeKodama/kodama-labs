import React from "react";
import { Routes as ReactRoutes, Route } from "react-router-dom";
import WithLayout from "./WithLayout";
// Available layouts
import { Main as MainLayout } from "./layouts";

// Landing pages
import { Wallex as WallexView } from "./views/landingPages";

// Supporting pages
import {
  Privacy as PrivacyView,
  Terms as TermsView,
} from "./views/supportingPages";

const Routes = () => {
  return (
    <ReactRoutes>
      <Route
        path="/"
        element={((matchProps) => (
          <WithLayout
            // @ts-ignore
            {...matchProps}
            component={WallexView}
            layout={MainLayout}
          />
        ))()}
      />
      <Route
        path="/page-privacy"
        element={((matchProps) => (
          <WithLayout
            // @ts-ignore
            {...matchProps}
            component={PrivacyView}
            layout={MainLayout}
          />
        ))()}
      />
      <Route
        path="/page-terms"
        element={((matchProps) => (
          <WithLayout
            // @ts-ignore
            {...matchProps}
            component={TermsView}
            layout={MainLayout}
          />
        ))()}
      />
    </ReactRoutes>
  );
};

export default Routes;
