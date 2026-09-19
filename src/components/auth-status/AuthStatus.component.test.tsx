import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AuthStatus from "./AuthStatus";
import { AUTH_STATUS_TEST_IDS } from "./AuthStatus.testIds";

vi.mock("@/actions/session", () => ({ signOutAction: vi.fn() }));

describe("AuthStatus", () => {
  it("should show the signed-in user's email and a sign-out control", () => {
    // Act
    render(<AuthStatus email="person@example.com" />);

    // Assert
    expect(screen.getByTestId(AUTH_STATUS_TEST_IDS.email)).toHaveTextContent("person@example.com");
    expect(screen.getByTestId(AUTH_STATUS_TEST_IDS.signOutButton)).toBeEnabled();
  });
});
