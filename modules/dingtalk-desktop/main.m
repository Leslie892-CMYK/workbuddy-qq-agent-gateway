#import <AppKit/AppKit.h>
#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int count = 0;
static void quoted(const char *value) {
    putchar('"');
    for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
        if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
        else if (*p == '\n') fputs("\\n", stdout);
        else if (*p == '\r') fputs("\\r", stdout);
        else if (*p == '\t') fputs("\\t", stdout);
        else if (*p >= 32) putchar(*p);
    }
    putchar('"');
}
static char *string(CFTypeRef value) {
    if (!value || CFGetTypeID(value) != CFStringGetTypeID()) return strdup("");
    CFStringRef text = (CFStringRef)value;
    CFIndex cap = CFStringGetMaximumSizeForEncoding(CFStringGetLength(text), kCFStringEncodingUTF8) + 1;
    char *result = calloc((size_t)cap, 1);
    if (!CFStringGetCString(text, result, cap, kCFStringEncodingUTF8)) result[0] = 0;
    return result;
}
static CFTypeRef get(AXUIElementRef element, CFStringRef name) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess) return NULL;
    return value;
}
static void walk(AXUIElementRef element, int depth) {
    if (depth > 32 || count >= 10000) return;
    CFTypeRef roleRef = get(element, kAXRoleAttribute);
    CFTypeRef valueRef = get(element, kAXValueAttribute);
    CFTypeRef titleRef = get(element, kAXTitleAttribute);
    CFTypeRef descRef = get(element, kAXDescriptionAttribute);
    char *role = string(roleRef), *value = string(valueRef), *title = string(titleRef), *desc = string(descRef);
    const char *label = *value ? value : (*title ? title : desc);
    Boolean editable = false;
    AXUIElementIsAttributeSettable(element, kAXValueAttribute, &editable);
    CGPoint point = CGPointZero; CGSize size = CGSizeZero;
    CFTypeRef position = get(element, kAXPositionAttribute), extent = get(element, kAXSizeAttribute);
    if (position && CFGetTypeID(position) == AXValueGetTypeID()) AXValueGetValue((AXValueRef)position, kAXValueCGPointType, &point);
    if (extent && CFGetTypeID(extent) == AXValueGetTypeID()) AXValueGetValue((AXValueRef)extent, kAXValueCGSizeType, &size);
    if (*label || editable) {
        if (count++) putchar(',');
        fputs("{\"role\":", stdout); quoted(role);
        fputs(",\"value\":", stdout); quoted(label);
        printf(",\"x\":%.1f,\"y\":%.1f,\"width\":%.1f,\"height\":%.1f,\"editable\":%s}",
               point.x, point.y, size.width, size.height, editable ? "true" : "false");
    }
    CFTypeRef children = get(element, kAXChildrenAttribute);
    if (children && CFGetTypeID(children) == CFArrayGetTypeID()) {
        CFArrayRef array = (CFArrayRef)children;
        CFIndex length = CFArrayGetCount(array);
        for (CFIndex i = 0; i < length; i++) walk((AXUIElementRef)CFArrayGetValueAtIndex(array, i), depth + 1);
    }
    if (children) CFRelease(children);
    if (position) CFRelease(position); if (extent) CFRelease(extent);
    if (roleRef) CFRelease(roleRef); if (valueRef) CFRelease(valueRef);
    if (titleRef) CFRelease(titleRef); if (descRef) CFRelease(descRef);
    free(role); free(value); free(title); free(desc);
}
int main(int argc, char **argv) {
    Boolean trusted = AXIsProcessTrusted();
    NSArray<NSRunningApplication *> *apps = [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.alibaba.DingTalkMac"];
    if (argc > 1 && strcmp(argv[1], "--probe") == 0) {
        printf("{\"trusted\":%s,\"running\":%s}\n", trusted ? "true" : "false", apps.count ? "true" : "false");
        return 0;
    }
    if (!trusted) { fputs("{\"error\":\"需要 macOS 辅助功能权限\"}\n", stderr); return 3; }
    if (!apps.count) { fputs("{\"error\":\"钉钉未运行\"}\n", stderr); return 4; }
    AXUIElementRef app = AXUIElementCreateApplication(apps.firstObject.processIdentifier);
    putchar('['); walk(app, 0); puts("]"); CFRelease(app);
    return 0;
}
