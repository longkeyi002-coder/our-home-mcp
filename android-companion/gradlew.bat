@rem Gradle wrapper launcher for Windows.
@echo off
set DIRNAME=%~dp0
if "%JAVA_HOME%" == "" set JAVA_EXE=java.exe
if not "%JAVA_HOME%" == "" set JAVA_EXE=%JAVA_HOME%\bin\java.exe
"%JAVA_EXE%" -Dorg.gradle.appname=gradlew -classpath "%DIRNAME%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
