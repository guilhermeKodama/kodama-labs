import React from "react";
import { Routes as ReactRoutes, Route } from "react-router-dom";
import WithLayout from "./WithLayout";
// Available layouts
import { Main as MainLayout } from "./layouts";

// Landing pages
import { Wallex as WallexView } from "./views/landingPages";

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
    </ReactRoutes>
  );
};

export default Routes;
