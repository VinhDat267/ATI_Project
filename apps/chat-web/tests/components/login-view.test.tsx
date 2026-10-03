/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { LoginView } from "../../src/components/LoginView";

afterEach(() => {
  cleanup();
});

describe("LoginView Component", () => {
  it("warns about Caps Lock only while typing a password and blocks submission while pending", () => {
    const onLogin = vi.fn((event) => event.preventDefault());
    const props = {
      email: "user@example.test",
      setEmail: vi.fn(),
      password: "fixture-only",
      setPassword: vi.fn(),
      isLoggingIn: false,
      authError: null,
      onLogin,
    };
    const { rerender } = render(<LoginView {...props} />);
    const password = screen.getByLabelText("Mật khẩu");
    fireEvent.keyUp(password, { key: "A", modifierCapsLock: true });
    expect(screen.getByRole("status")).toHaveTextContent("Caps Lock đang bật.");
    expect(password).toHaveAttribute("aria-describedby", "login-caps-lock");
    fireEvent.blur(password);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<LoginView {...props} isLoggingIn />);
    expect(
      screen.getByRole("button", { name: "Hiện mật khẩu" }),
    ).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Đăng nhập Planora" }));
    expect(onLogin).not.toHaveBeenCalled();
  });
  it("offers account creation only when the API enables it", () => {
    const onSignup=vi.fn();
    const props={email:"",password:"",setEmail:vi.fn(),setPassword:vi.fn(),isLoggingIn:false,authError:null,onLogin:vi.fn(),onSignup};
    const {rerender}=render(<LoginView {...props}/>);
    expect(screen.queryByRole("button",{name:/Tạo tài khoản/})).toBeNull();
    rerender(<LoginView {...props} signupEnabled/>);
    fireEvent.click(screen.getByRole("button",{name:/Tạo tài khoản/}));
    expect(onSignup).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("heading",{name:/Điều lớn lao/})).toBeInTheDocument();
  });  it("renders split-screen branding and essential form elements", () => {
    const setEmail = vi.fn();
    const setPassword = vi.fn();
    const onLogin = vi.fn();

    render(
      <LoginView
        email=""
        setEmail={setEmail}
        password=""
        setPassword={setPassword}
        isLoggingIn={false}
        authError={null}
        onLogin={onLogin}
      />,
    );

    // Product identity and public footer share a single destination.
    expect(screen.getByRole("contentinfo",{name:"Chân trang Planora"})).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Dịch vụ"})).toHaveAttribute("href","/?view=landing#services");
    // Form inputs accessible by label
    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.getByLabelText("Mật khẩu")).toBeDefined();

    // Submit button
    const submitBtn = screen.getByRole("button", { name: "Đăng nhập" });
    expect(submitBtn).toBeDefined();
    expect(submitBtn.hasAttribute("disabled")).toBe(false);
  });

  it("handles input changes and form submission", () => {
    const setEmail = vi.fn();
    const setPassword = vi.fn();
    const onLogin = vi.fn((e) => e.preventDefault());

    render(
      <LoginView
        email="test@example.com"
        setEmail={setEmail}
        password="secret"
        setPassword={setPassword}
        isLoggingIn={false}
        authError={null}
        onLogin={onLogin}
      />,
    );

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "user@example.com" },
    });
    expect(setEmail).toHaveBeenCalledWith("user@example.com");

    fireEvent.change(screen.getByLabelText("Mật khẩu"), {
      target: { value: "mypassword" },
    });
    expect(setPassword).toHaveBeenCalledWith("mypassword");

    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    expect(onLogin).toHaveBeenCalled();
  });

  it("does not offer admin credential injection", () => {
    render(
      <LoginView
        email=""
        setEmail={vi.fn()}
        password=""
        setPassword={vi.fn()}
        isLoggingIn={false}
        authError={null}
        onLogin={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Điền nhanh/ })).toBeNull();
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute(
      "type",
      "password",
    );
    fireEvent.click(screen.getByRole("button", { name: /Hiện mật khẩu/ }));
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute("type", "text");
  });

  it("displays auth error alert when authError is present", () => {
    render(
      <LoginView
        email="admin@test.com"
        setEmail={vi.fn()}
        password="wrong"
        setPassword={vi.fn()}
        isLoggingIn={false}
        authError="Email hoặc mật khẩu không chính xác"
        onLogin={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeDefined();
    expect(alert.textContent).toContain("Email hoặc mật khẩu không chính xác");
  });

  it("disables submit button and shows loading state when isLoggingIn is true", () => {
    render(
      <LoginView
        email="admin@test.com"
        setEmail={vi.fn()}
        password="secret"
        setPassword={vi.fn()}
        isLoggingIn={true}
        authError={null}
        onLogin={vi.fn()}
      />,
    );

    const submitBtn = screen.getByRole("button", { name: /Đang đăng nhập/i });
    expect(submitBtn.hasAttribute("disabled")).toBe(true);
  });

  it("triggers onBackToLanding when the back button is clicked", () => {
    const onBackToLanding = vi.fn();
    render(
      <LoginView
        email=""
        setEmail={vi.fn()}
        password=""
        setPassword={vi.fn()}
        isLoggingIn={false}
        authError={null}
        onLogin={vi.fn()}
        onBackToLanding={onBackToLanding}
      />,
    );

    const backBtn = screen.getByRole("button", {
      name: /Quay lại trang giới thiệu/i,
    });
    expect(backBtn).toBeDefined();

    fireEvent.click(backBtn);
    expect(onBackToLanding).toHaveBeenCalledTimes(1);
  });

  it("translates generic Invalid email or password error into helpful Vietnamese guidance", () => {
    render(
      <LoginView
        email="admin@test.com"
        setEmail={vi.fn()}
        password="wrong"
        setPassword={vi.fn()}
        isLoggingIn={false}
        authError="Invalid email or password"
        onLogin={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Email hoặc mật khẩu không chính xác");
    expect(screen.queryByText("Roadmap")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Google|Đăng ký|Quên mật khẩu/ }),
    ).toBeNull();
  });
});
