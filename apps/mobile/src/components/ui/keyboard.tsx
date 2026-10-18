/**
 * Keeps the focused text input above the software keyboard, app-wide.
 *
 * Why not `KeyboardAvoidingView` or `adjustResize`: the app runs edge-to-edge
 * on Android (gradle `edgeToEdgeEnabled=true`, enforced from targetSdk 35), and
 * an edge-to-edge window is never resized for the IME, so `adjustResize` does
 * nothing and the keyboard simply covers the bottom of the screen. RN's
 * `KeyboardAvoidingView` compares a parent-relative frame with window-relative
 * keyboard coordinates, so it needs a hand-tuned offset per screen and silently
 * does nothing when `behavior` is undefined (which is how every screen used it
 * on Android).
 *
 * `KeyboardAwareScrollView` instead:
 *  1. listens to the keyboard (`keyboardWillShow/Hide` on iOS, `keyboardDidShow/Hide`
 *     on Android, which RN derives from the window's IME insets);
 *  2. measures its own container in window coordinates and pads its bottom by
 *     exactly the part the keyboard covers, so the scroll viewport ends at the
 *     keyboard's top edge whatever headers / safe-area insets sit above it;
 *  3. scrolls the focused input (`TextInput.State.currentlyFocusedInput()`)
 *     into that viewport, with a margin, when the keyboard appears, when focus
 *     moves to another field, and when a multiline field grows.
 *
 * A `Modal` is a separate Android window that RN does not report keyboard
 * events for, so a scroll view inside one can pass `inModal`: if no keyboard
 * event follows a focus on Android, the keyboard height is estimated from the
 * last real keyboard seen (or a share of the screen).
 *
 * Inputs opt in through `useKeyboardAwareInput()` (the shared `Field` already
 * does) or by rendering `KeyboardAwareTextInput` instead of `TextInput`. The
 * hook reads context, so it must run in a component rendered *inside* the
 * scroll view; without one around it, it is a no-op.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  HostInstance,
  Keyboard,
  KeyboardEvent,
  LayoutAnimation,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import {
  computeScrollTarget,
  FALLBACK_KEYBOARD_RATIO,
  FOCUS_MARGIN,
  keyboardOverlap,
  resolveKeyboardTop,
} from './keyboardLayout';

/** Height of the last real keyboard, measured from the bottom of the screen. */
let lastKeyboardHeight: number | null = null;

interface KeyboardAwareContext {
  reveal: () => void;
  onInputFocus: () => void;
  onInputBlur: () => void;
}

const Ctx = createContext<KeyboardAwareContext | null>(null);

/**
 * Handlers for a `TextInput` that should stay visible above the keyboard.
 * Call them from the input's own `onFocus` / `onBlur` / `onContentSizeChange`
 * (compose with any handler the input already has).
 */
export function useKeyboardAwareInput() {
  const ctx = useContext(Ctx);
  return useMemo(
    () => ({
      onFocus: () => ctx?.onInputFocus(),
      onBlur: () => ctx?.onInputBlur(),
      /** For multiline inputs: keep the growing field (and its caret) in view. */
      onContentSizeChange: () => ctx?.reveal(),
    }),
    [ctx],
  );
}

/** Drop-in `TextInput` that keeps itself visible above the keyboard. */
export const KeyboardAwareTextInput = React.forwardRef<TextInput, TextInputProps>(
  function KeyboardAwareTextInput(props, ref) {
    const keyboardAware = useKeyboardAwareInput();
    return (
      <TextInput
        ref={ref}
        {...props}
        onFocus={(e) => {
          keyboardAware.onFocus();
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          keyboardAware.onBlur();
          props.onBlur?.(e);
        }}
        onContentSizeChange={
          props.multiline
            ? (e) => {
                keyboardAware.onContentSizeChange();
                props.onContentSizeChange?.(e);
              }
            : props.onContentSizeChange
        }
      />
    );
  },
);

export interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  /** Style of the non-scrolling container that receives the keyboard inset. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Space kept between the focused input and the keyboard. */
  focusMargin?: number;
  /** Set when rendered inside a `Modal` (a separate window on Android). */
  inModal?: boolean;
}

export const KeyboardAwareScrollView = React.forwardRef<ScrollView, KeyboardAwareScrollViewProps>(
  function KeyboardAwareScrollView(
    {
      children,
      containerStyle,
      focusMargin = FOCUS_MARGIN,
      inModal = false,
      onLayout,
      onScroll,
      onContentSizeChange,
      keyboardShouldPersistTaps = 'handled',
      keyboardDismissMode = Platform.OS === 'ios' ? 'interactive' : 'on-drag',
      scrollEventThrottle = 16,
      ...scrollProps
    },
    forwardedRef,
  ) {
    const outerRef = useRef<View>(null);
    const scrollRef = useRef<ScrollView | null>(null);
    const [inset, setInset] = useState(0);
    const insetRef = useRef(0);
    const keyboardTopRef = useRef<number | null>(null);
    const estimatedRef = useRef(false);
    const scrollYRef = useRef(0);
    const viewportRef = useRef(0);
    const contentHRef = useRef(0);
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
    const mounted = useRef(true);

    const later = useCallback((fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timers.current.delete(id);
        if (mounted.current) fn();
      }, ms);
      timers.current.add(id);
    }, []);

    useEffect(() => {
      mounted.current = true;
      const pending = timers.current;
      return () => {
        mounted.current = false;
        pending.forEach(clearTimeout);
        pending.clear();
      };
    }, []);

    const setRef = useCallback(
      (node: ScrollView | null) => {
        scrollRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    /** Scroll the focused input (if it lives in this scroll view) into the visible area. */
    const reveal = useCallback(() => {
      const scroll = scrollRef.current;
      const input = TextInput.State.currentlyFocusedInput() as HostInstance | null;
      // getInnerViewRef is part of ScrollView's public JS API but missing from its .d.ts.
      const content = (scroll as unknown as { getInnerViewRef?: () => HostInstance | null } | null)
        ?.getInnerViewRef?.();
      if (!scroll || !input || !content) return;
      try {
        input.measureLayout(
          content,
          (_x, y, _w, h) => {
            const target = computeScrollTarget({
              inputY: y,
              inputHeight: h,
              scrollY: scrollYRef.current,
              viewportHeight: viewportRef.current,
              contentHeight: contentHRef.current,
              margin: focusMargin,
            });
            if (target != null) scrollRef.current?.scrollTo({ y: target, animated: true });
          },
          // Not a descendant of this scroll view (another screen, or a modal): ignore.
          () => {},
        );
      } catch {
        // Input unmounted between focus and measurement.
      }
    }, [focusMargin]);

    const updateInset = useCallback((value: number, duration?: number) => {
      if (value === insetRef.current) return;
      insetRef.current = value;
      if (Platform.OS === 'ios' && duration) {
        LayoutAnimation.configureNext({
          duration: Math.max(duration, 10),
          update: { duration: Math.max(duration, 10), type: LayoutAnimation.Types.keyboard },
        });
      }
      setInset(value);
    }, []);

    /** Apply a keyboard whose top edge is at `top` (window coordinates), or none. */
    const applyKeyboard = useCallback(
      (top: number | null, duration?: number) => {
        keyboardTopRef.current = top;
        if (top == null) {
          updateInset(0, duration);
          return;
        }
        const outer = outerRef.current;
        if (!outer) return;
        outer.measureInWindow((_x, y, _w, h) => {
          if (!mounted.current || keyboardTopRef.current !== top) return;
          updateInset(keyboardOverlap(y + h, top), duration);
          // The viewport's onLayout reveals the input once it has shrunk; this
          // covers the case where the inset did not change (no new layout).
          later(reveal, Platform.OS === 'ios' ? (duration ?? 250) + 30 : 120);
        });
      },
      [later, reveal, updateInset],
    );

    const onKeyboardShow = useCallback(
      (e: KeyboardEvent) => {
        const { screenY, height } = e.endCoordinates;
        const top = resolveKeyboardTop(screenY, height, Dimensions.get('window').height);
        lastKeyboardHeight = Math.max(0, Dimensions.get('screen').height - top);
        estimatedRef.current = false;
        applyKeyboard(top, e.duration);
      },
      [applyKeyboard],
    );

    const onKeyboardHide = useCallback(
      (e?: KeyboardEvent) => {
        estimatedRef.current = false;
        applyKeyboard(null, e?.duration);
      },
      [applyKeyboard],
    );

    useEffect(() => {
      const subs =
        Platform.OS === 'ios'
          ? [
              Keyboard.addListener('keyboardWillShow', onKeyboardShow),
              Keyboard.addListener('keyboardWillHide', onKeyboardHide),
            ]
          : [
              Keyboard.addListener('keyboardDidShow', onKeyboardShow),
              Keyboard.addListener('keyboardDidHide', onKeyboardHide),
            ];
      return () => subs.forEach((s) => s.remove());
    }, [onKeyboardHide, onKeyboardShow]);

    const onInputFocus = useCallback(() => {
      // Keyboard already up (focus moved between fields): just scroll.
      later(reveal, 60);
      if (Platform.OS !== 'android' || !inModal) return;
      // Android modal: RN reports no keyboard events for the dialog window.
      later(() => {
        if (keyboardTopRef.current != null || !TextInput.State.currentlyFocusedInput()) return;
        const screenH = Dimensions.get('screen').height;
        const height = lastKeyboardHeight ?? Math.round(screenH * FALLBACK_KEYBOARD_RATIO);
        estimatedRef.current = true;
        applyKeyboard(screenH - height);
      }, 450);
    }, [applyKeyboard, inModal, later, reveal]);

    const onInputBlur = useCallback(() => {
      if (!estimatedRef.current) return;
      later(() => {
        if (estimatedRef.current && !TextInput.State.currentlyFocusedInput()) {
          estimatedRef.current = false;
          applyKeyboard(null);
        }
      }, 120);
    }, [applyKeyboard, later]);

    const onOuterLayout = useCallback(() => {
      // Our own inset is padding inside this view, so this only runs on real
      // size changes (rotation, or a window that did resize): re-measure.
      if (keyboardTopRef.current != null) applyKeyboard(keyboardTopRef.current);
      else if (!inModal && Keyboard.isVisible()) {
        const m = Keyboard.metrics();
        if (m) {
          applyKeyboard(resolveKeyboardTop(m.screenY, m.height, Dimensions.get('window').height));
        }
      }
    }, [applyKeyboard, inModal]);

    const handleLayout = useCallback(
      (e: LayoutChangeEvent) => {
        viewportRef.current = e.nativeEvent.layout.height;
        if (keyboardTopRef.current != null) reveal();
        onLayout?.(e);
      },
      [onLayout, reveal],
    );

    const handleScroll = useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollYRef.current = e.nativeEvent.contentOffset.y;
        onScroll?.(e);
      },
      [onScroll],
    );

    const handleContentSize = useCallback(
      (w: number, h: number) => {
        contentHRef.current = h;
        onContentSizeChange?.(w, h);
      },
      [onContentSizeChange],
    );

    const ctx = useMemo(() => ({ reveal, onInputFocus, onInputBlur }), [onInputBlur, onInputFocus, reveal]);

    return (
      <View
        ref={outerRef}
        collapsable={false}
        onLayout={onOuterLayout}
        style={[{ flex: 1 }, containerStyle, { paddingBottom: inset }]}
      >
        <Ctx.Provider value={ctx}>
          <ScrollView
            ref={setRef}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            keyboardDismissMode={keyboardDismissMode}
            scrollEventThrottle={scrollEventThrottle}
            {...scrollProps}
            onLayout={handleLayout}
            onScroll={handleScroll}
            onContentSizeChange={handleContentSize}
          >
            {children}
          </ScrollView>
        </Ctx.Provider>
      </View>
    );
  },
);
