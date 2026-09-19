import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import ModeToggle from "./ModeToggle";
import { MODE_TOGGLE_TEST_IDS } from "./ModeToggle.testIds";

describe("ModeToggle", () => {
  beforeEach(() => {
    document.cookie = "isDarkMode=; path=/; max-age=0";
    document.documentElement.classList.remove("dark");
  });

  it("should toggle from light to dark when clicked", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<ModeToggle initialIsDarkMode={false} />);

    // Assert
    expect(screen.getByTestId(MODE_TOGGLE_TEST_IDS.label)).toHaveTextContent("Mode is light");

    // Act
    await user.click(screen.getByTestId(MODE_TOGGLE_TEST_IDS.button));

    // Assert
    expect(screen.getByTestId(MODE_TOGGLE_TEST_IDS.label)).toHaveTextContent("Mode is dark");
  });

  it("should render as dark when seeded with initialIsDarkMode", () => {
    // Act
    render(<ModeToggle initialIsDarkMode={true} />);

    // Assert
    expect(screen.getByTestId(MODE_TOGGLE_TEST_IDS.label)).toHaveTextContent("Mode is dark");
  });
});
