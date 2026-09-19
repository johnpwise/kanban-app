import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SubscribeForm from "./SubscribeForm";
import { SUBSCRIBE_FORM_TEST_IDS } from "./SubscribeForm.testIds";

describe("SubscribeForm", () => {
  it("should render an accessible, enabled email input and submit control", () => {
    // Arrange

    // Act
    render(<SubscribeForm />);

    // Assert
    const emailInput = screen.getByLabelText("Email");
    const submitButton = screen.getByTestId(SUBSCRIBE_FORM_TEST_IDS.submitButton);

    expect(emailInput).toHaveAttribute("data-id", SUBSCRIBE_FORM_TEST_IDS.emailInput);
    expect(emailInput).toBeEnabled();
    expect(submitButton).toBeEnabled();
  });
});
