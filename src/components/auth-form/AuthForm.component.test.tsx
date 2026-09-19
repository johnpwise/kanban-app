import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FirebaseError } from "firebase/app";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { establishSessionAction } from "@/actions/session";

import AuthForm from "./AuthForm";
import { AUTH_FORM_TEST_IDS } from "./AuthForm.testIds";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const signInWithEmailAndPasswordMock = vi.fn();
const createUserWithEmailAndPasswordMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: (...args: unknown[]) => signInWithEmailAndPasswordMock(...args),
  createUserWithEmailAndPassword: (...args: unknown[]) => createUserWithEmailAndPasswordMock(...args),
}));

vi.mock("@/lib/firebase/client", () => ({ auth: {} }));
vi.mock("@/actions/session", () => ({ establishSessionAction: vi.fn() }));

const establishSessionActionMock = vi.mocked(establishSessionAction);

describe("AuthForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should sign in and establish a session on valid credentials", async () => {
    // Arrange
    const user = userEvent.setup();
    const getIdToken = vi.fn().mockResolvedValue("id-token");
    signInWithEmailAndPasswordMock.mockResolvedValue({ user: { getIdToken } });
    establishSessionActionMock.mockResolvedValue({ status: "idle" });
    render(<AuthForm mode="sign-in" />);

    // Act
    await user.type(screen.getByTestId(AUTH_FORM_TEST_IDS.emailInput), "person@example.com");
    await user.type(screen.getByTestId(AUTH_FORM_TEST_IDS.passwordInput), "password123");
    await user.click(screen.getByTestId(AUTH_FORM_TEST_IDS.submit));

    // Assert
    expect(signInWithEmailAndPasswordMock).toHaveBeenCalledWith({}, "person@example.com", "password123");
    expect(establishSessionActionMock).toHaveBeenCalledWith("id-token");
    expect(pushMock).toHaveBeenCalledWith("/");
  });

  it("should show a friendly message when sign-in fails", async () => {
    // Arrange
    const user = userEvent.setup();
    signInWithEmailAndPasswordMock.mockRejectedValue(new FirebaseError("auth/wrong-password", "bad credentials"));
    render(<AuthForm mode="sign-in" />);

    // Act
    await user.type(screen.getByTestId(AUTH_FORM_TEST_IDS.emailInput), "person@example.com");
    await user.type(screen.getByTestId(AUTH_FORM_TEST_IDS.passwordInput), "wrongpassword");
    await user.click(screen.getByTestId(AUTH_FORM_TEST_IDS.submit));

    // Assert
    expect(await screen.findByTestId(AUTH_FORM_TEST_IDS.error)).toHaveTextContent(
      "Incorrect email or password.",
    );
    expect(establishSessionActionMock).not.toHaveBeenCalled();
  });

  it("should render a create-account submit label in sign-up mode", () => {
    // Act
    render(<AuthForm mode="sign-up" />);

    // Assert
    expect(screen.getByTestId(AUTH_FORM_TEST_IDS.submit)).toHaveTextContent("Create account");
  });
});
